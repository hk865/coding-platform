/**
 * CM-1A-001 第 3 工作段 — 目标 Delivery 精确版本进入**实际模型输入**的材料通道（A06 的输入面）。
 *
 * ── 走的是哪条既有通道（不新增第二选材器）────────────────────────────────────────
 * 本编译器只产出 `RuntimeContextText`（`RuntimeContextMaterials.rules`）：正文进
 * `assembleRuntimeContext` 的 `input`，摘要/来源/理由进 `manifest.selected`，
 * 两者由 `manifest.inputDigest` 合并。**不给 TaskEnvelopeV1 加字段、不扩 SourceRefV1.kind**
 * （它是封闭四值，扩它有回归风险）——这正是 decision-log D06 选定的载体。
 *
 * ── 授权顺序（与既有 feedback 通道逐条一致）───────────────────────────────────
 *   1. `select`：读该 Run 所属 Work 的既有 Delivery（canonical，只读面），并 capture 本次的
 *      来源 pin（`SourceApplicabilityPort`）作为 basis；读不到、来源不可用一律抛错；
 *   2. Dispatch 侧 `WorkMaterialDrive` 用`materialAccessGrantIdFor(runRef, materials, basis)`
 *      给**本次 Run** 逐条签发精确 `MaterialAccessGrant`（非 committed 即抛错：运行尚未启动）；
 *   3. `assemble`：`vault.open(bodyRef, {requesterRunRef, currentBasis: basis, usage:'current'})`
 *      —— grant 一致、basis 一致、来源 pin 仍当前才读得到；
 *   4. `assemble` 内**再复核一次来源**（重读 pin 必须等于 basis.sourcePin）并逐条核对正文摘要；
 *   5. 最后才组装 rule。
 *
 * ── 为什么必须 fail-closed ───────────────────────────────────────────────────
 * Delivery 只证明"目标 Work 获得了一个可见引用"，**不授予**正文读取（见 contracts/coordination.ts
 * 的 DeliveryV1）。因此这里的每一次失败都是**整次材料组装失败**（`assembleRun` 抛错 →
 * LeasedWorkerRuntime 登记"可证明未启动"的已知失败 → 本次运行不调用模型），
 * 绝不"静默跳过这条 Delivery 继续跑"，也绝不复用上一次已读到的正文。
 *
 * ── 选材范围：**只按 admission 固定的集合**（第 3 工作段收窄）────────────────────
 *   · 本 Run 是接续产生的（CommunicationAdmission）时，必需材料**恰好**是那次受理固定下来的
 *     deliveryRefs（见 coordination-admission-read.ts）。读不到其中任何一条即整次组装失败，
 *     而不是"少一条也照跑"。
 *   · 本 Run 不是接续产生的（普通任务运行）时，本次**不消费任何 Delivery**：不再把该 Work
 *     当前邮箱里全部带正文的 Delivery 当成本次必需输入——那是邮箱，不是本次输入。
 *   · 其他可选材料（角色必读、历史、工作身份等）仍由既有 Context 规则选择，本文件不改它们。
 *   · 材料资格是"参考"：它不改变 permissions、不构成完成判据。
 */
import type { ArtifactPort, ArtifactRef } from '../../contracts/artifact.js';
import type { TaskEnvelopeV1 } from '../../contracts/task-envelope.js';
import type { SourceRefV1 } from '../../contracts/dispatch.js';
import type { DeliveryRef, DeliverySnapshot, DeliveryV1 } from '../../contracts/coordination.js';
import type { MaterialBasisV1, SourceApplicabilityPort } from '../../contracts/material-access.js';
import type { AdmittedDeliveryReadPort, RuntimeContextText } from '../../contracts/runtime-context-materials.js';
import { ARTIFACT_MAX_SIZE_BYTES, artifactBodyDigest, artifactBodySize } from '../../contracts/artifact.js';
import { canonicalJson, sha256Hex } from '../../contracts/fingerprint.js';

/**
 * 一次选材最多消费的 Delivery 条数（超限如实失败，不静默裁剪）。
 *
 * 收窄之后这个上界不再是"邮箱的有界裁剪"：集合来自 admission 固定的 deliveryRefs，
 * 它的上界本来就由协议给出（一个 wait 最多 WAIT_MAX_CONDITIONS 条条件、一个路由页最多
 * COMMUNICATION_PAGE_MAX_DELIVERIES 条投递）。这里保留一条显式上界，是为了让"受理记录被
 * 篡改成超大集合"这类情况也 fail-closed，而不是悄悄多读几百份正文。
 */
export const DELIVERY_MATERIAL_MAX_ITEMS = 64;
/** 该 Work 的 Delivery 材料来源集：整份可读工作区（与 feedback 通道同一口径）。 */
const DELIVERY_SOURCE_SET = { kind: 'workspace_paths', paths: ['.'] } as const;

export type DeliveryMaterialEntry = {
  ref: DeliveryRef;
  delivery: DeliveryV1;
  bodyRef: ArtifactRef;
};

export type DeliveryMaterialSelection = {
  envelope: TaskEnvelopeV1;
  workId: string;
  entries: DeliveryMaterialEntry[];
  basis: MaterialBasisV1;
};

export type DeliveryMaterialCompilerDeps = {
  /**
   * 本 Run **被受理固定**的 Delivery 只读面。产品实现见
   * src/control/dispatch-engine/coordination-admission-read.ts（按 canonical 事实回答
   * "这次接续固定了哪几条投递"），由组合根注入。
   */
  admitted: AdmittedDeliveryReadPort;
  vault: ArtifactPort;
  /**
   * 受信任的来源身份能力（宿主注入，绑定到真实、经权限检查的工作区读取）。
   * 缺省表示宿主没有接线：此时**任何** current 读取都无法成立（vault 对 usage='current'
   * 要求有效的 source pin），因此显式失败，而不是"没有来源也能读"。
   */
  source?: SourceApplicabilityPort;
};

export class DeliveryMaterialCompiler {
  constructor(private readonly deps: DeliveryMaterialCompilerDeps) {}

  /**
   * 读该 Run 所属 Work 的既有 Delivery 并 capture 来源 basis。
   * 返回的 entries 只包含**带正文**的 Delivery（没有正文的投递不构成本次输入材料）。
   */
  async select(envelope: TaskEnvelopeV1, workId: string): Promise<DeliveryMaterialSelection> {
    if (typeof workId !== 'string' || workId.length === 0) throw Error('Delivery 材料：缺少本 Run 的工作身份');
    const read = await this.deps.admitted.admittedDeliveriesForRun({
      projectId: envelope.projectId,
      workspaceId: envelope.workspaceId,
      runId: envelope.runRef.runId,
    });
    if (read.status === 'unavailable') throw Error('Delivery 材料读取面不可用：' + read.reason);
    // 不是接续产生的 Run：本次输入不消费任何 Delivery。这里**不**回退到"读该 Work 的邮箱"——
    // 那会把历史投递与别人的报告塞进一个不需要它们的运行。
    const admitted = read.status === 'admitted' ? read.deliveries : [];
    const seen = new Set<string>();
    const entries: DeliveryMaterialEntry[] = [];
    for (const snapshot of [...admitted].sort((a, b) => a.ref.deliveryId.localeCompare(b.ref.deliveryId))) {
      const delivery = snapshot.delivery;
      // 归属复核：受理记录已经固定了集合，这里再按 canonical 事实核对一次（不猜、不信任入口）。
      if (delivery.targetWorkContextRef.projectId !== envelope.projectId ||
          delivery.targetWorkContextRef.workspaceId !== envelope.workspaceId ||
          delivery.targetWorkContextRef.workId !== workId) {
        throw Error('受理固定的 Delivery 不属于本 Run 的 Work：' + delivery.deliveryId +
          '（target=' + delivery.targetWorkContextRef.workId + '，本次 work=' + workId + '）');
      }
      if (seen.has(delivery.deliveryId)) continue;
      seen.add(delivery.deliveryId);
      // 没有正文的投递只证明"这个位置发生过这件事"，不构成正文材料（仍然留在集合里，
      // 只是不进模型输入）；它的存在与否不影响其余材料的组装。
      if (delivery.bodyRef === null) continue;
      entries.push({ ref: snapshot.ref, delivery, bodyRef: delivery.bodyRef });
    }
    if (admitted.length > DELIVERY_MATERIAL_MAX_ITEMS) {
      throw Error('受理固定的 Delivery 超过有界上限 ' + String(DELIVERY_MATERIAL_MAX_ITEMS) + '：不静默裁剪，请缩窄本次工作范围');
    }
    const basis = await this.captureBasis(envelope);
    return { envelope, workId, entries, basis };
  }

  /** 需要签发精确读授权的材料集合（1..N；空集合表示本次不需要签发）。 */
  materialsOf(selection: DeliveryMaterialSelection): ArtifactRef[] {
    return selection.entries.map((entry) => entry.bodyRef);
  }

  /**
   * **先**打开（授权与 basis 由 vault 复核）→ **再**复核来源与摘要 → **最后**组装 rule。
   * 任何一步不成立都抛错：调用方（WorkMaterialDrive）在运行启动之前失败，模型不会被调用。
   */
  async assemble(selection: DeliveryMaterialSelection): Promise<RuntimeContextText[]> {
    if (selection.entries.length === 0) return [];
    if (this.deps.source === undefined) throw Error('Delivery 材料：宿主未接线来源身份能力，current 读取无法成立');
    const rules: RuntimeContextText[] = [];
    for (const entry of selection.entries) {
      const opened = await this.deps.vault.open(entry.bodyRef, {
        requesterRunRef: selection.envelope.runRef,
        currentBasis: selection.basis,
        usage: 'current',
      });
      if (opened.status !== 'ready') {
        // 撤权（grant 被吊销/不可核对）、来源更新（basis 不匹配）与缺料都收敛到这里：
        // 明确拒绝，绝不复用上一次读到的正文。
        throw Error('Delivery 材料不可读或被拒绝：' + entry.ref.deliveryId +
          '（' + opened.status + (opened.status === 'rejected' ? ':' + opened.code + ' ' + opened.issues.join('; ') : '') + '）');
      }
      if (artifactBodyDigest(opened.record.body) !== entry.bodyRef.digest || artifactBodySize(opened.record.body) !== entry.bodyRef.sizeBytes) {
        throw Error('Delivery 材料正文摘要不匹配：' + entry.ref.deliveryId);
      }
      if (artifactBodySize(opened.record.body) > ARTIFACT_MAX_SIZE_BYTES) {
        throw Error('Delivery 材料正文超过单件上限：' + entry.ref.deliveryId);
      }
      // 来源复核：重读 pin 必须仍是本次选材那一份（防止"读到一半来源被更新"）。
      const current = await this.captureBasis(selection.envelope);
      if (canonicalJson(current.sourcePin as never) !== canonicalJson(selection.basis.sourcePin as never)) {
        throw Error('Delivery 材料来源在组装期间发生变化：' + entry.ref.deliveryId);
      }
      const version = deliveryVersionOf(entry.delivery);
      const content = canonicalJson({
        qualification: 'reference',
        deliveryId: entry.delivery.deliveryId,
        deliveryVersion: version,
        origin: entry.delivery.origin,
        deliveredAt: entry.delivery.createdAt,
        body: opened.record.body,
      } as never);
      rules.push({
        content,
        digest: sha256Hex(content),
        sourceRefs: deliverySourceRefs(entry, version),
        selectedBecause: '正式投递到本 Run 所属 Work 的 Delivery ' + entry.delivery.deliveryId +
          '（' + version + '）：后继 Run 必须消费**这一份精确版本**；正文按当前来源与精确授权读取，未授予任何新权限。',
      });
    }
    return rules;
  }

  /** Recheck the original pins and grants; no selector runs and no new material
   * enters the already bound Context. Called at every provider boundary. */
  async assertCurrent(selection: DeliveryMaterialSelection): Promise<void> {
    if (selection.entries.length === 0) return;
    const current = await this.captureBasis(selection.envelope);
    if (canonicalJson(current as never) !== canonicalJson(selection.basis as never)) throw Error('Delivery material source changed');
    for (const entry of selection.entries) {
      const opened = await this.deps.vault.open(entry.bodyRef, {
        requesterRunRef: selection.envelope.runRef, currentBasis: selection.basis, usage: 'current',
      });
      if (opened.status !== 'ready' || artifactBodyDigest(opened.record.body) !== entry.bodyRef.digest) throw Error('Delivery material permission or body changed');
    }
  }

  private async captureBasis(envelope: TaskEnvelopeV1): Promise<MaterialBasisV1> {
    const source = this.deps.source;
    if (source === undefined) throw Error('Delivery 材料：宿主未接线来源身份能力，current 读取无法成立');
    const captured = await source.capture({
      projectId: envelope.projectId,
      workspaceId: envelope.workspaceId,
      sourceSet: { ...DELIVERY_SOURCE_SET, paths: [...DELIVERY_SOURCE_SET.paths] },
    });
    if (captured.status !== 'sourced') {
      // 撤权/来源不可用：**不**退化成"没有来源也能读"，本次材料组装直接失败。
      throw Error('Delivery 材料来源不可用（' + captured.status + '）：' + captured.issues.join('; '));
    }
    return {
      planRef: envelope.planRef,
      workspaceRevision: envelope.workspaceSnapshot.revision,
      sourceDigest: captured.pin.manifestDigest,
      sourcePin: captured.pin,
    };
  }
}

/** 一条 Delivery 的精确版本标识（directed_request 用请求 id，订阅用 topic@位置）。 */
export function deliveryVersionOf(delivery: DeliveryV1): string {
  return delivery.origin.kind === 'subscription'
    ? delivery.origin.sourceTopic + '@' + String(delivery.origin.sourceCursor)
    : 'directed_request@' + delivery.origin.requestRef.requestId;
}

/** manifest 里可逐条核对的来源（含版本）：材质本身 + 投递来源。 */
function deliverySourceRefs(entry: DeliveryMaterialEntry, version: string): SourceRefV1[] {
  const refs: SourceRefV1[] = [
    { kind: 'artifact', refId: entry.bodyRef.digest, revision: version, digest: entry.bodyRef.digest },
  ];
  for (const source of entry.delivery.sourceRefs) {
    refs.push({ kind: 'artifact', refId: source.refId, revision: source.revision });
  }
  if (entry.delivery.origin.kind === 'subscription') {
    refs.push({ kind: 'artifact', refId: entry.delivery.origin.subscriptionRef.subscriptionId, revision: version });
  }
  return refs;
}

export type { AdmittedDeliveryReadPort, DeliverySnapshot };
