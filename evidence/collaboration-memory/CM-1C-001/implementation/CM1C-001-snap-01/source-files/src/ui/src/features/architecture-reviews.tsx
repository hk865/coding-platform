import { useEffect, useState } from 'react';
import { Alert, Button, Group, Paper, Stack, Text, Textarea, Badge } from '@mantine/core';
import type { Api } from '../api/client';
import { errorMessage } from '../api/client';
import type { Scope } from '../api/types';
import type { ArchitectureReviewView } from '../../../contracts/architecture-review';
type Row = ArchitectureReviewView['rows'][number];
export function ArchitectureReviews({ api, scope }: {
    api: Api;
    scope: Scope;
}) {
    const [view, setView] = useState<ArchitectureReviewView | null>(null), [error, setError] = useState('');
    useEffect(() => {
        const abort = new AbortController();
        let timer: ReturnType<typeof setTimeout>;
        const read = async () => {
            try {
                const next = await api.architectureReviews(scope, { signal: abort.signal });
                if (!abort.signal.aborted) {
                    setView(next);
                    setError('');
                }
            }
            catch (e) {
                if (!abort.signal.aborted)
                    setError(errorMessage(e));
            }
            finally {
                if (!abort.signal.aborted)
                    timer = setTimeout(read, 2500);
            }
        };
        void read();
        return () => { abort.abort(); clearTimeout(timer); };
    }, [api, scope.projectId, scope.workspaceId]);
    return <Stack gap="sm" data-testid="architecture-reviews">{error ? <Alert color="red">架构决定状态不可读：{error}</Alert> : null}{view?.rows.map(row => <Review key={row.review.ref.reviewId + ':' + row.review.revision} row={row} api={api} scope={scope}/>)}</Stack>;
}
function Review({ row, api, scope }: {
    row: Row;
    api: Api;
    scope: Scope;
}) {
    const { review, proposal, brief } = row;
    const [summary, setSummary] = useState(''), [description, setDescription] = useState(proposal.normalizedContent.description ?? ''), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
    const [pending, setPending] = useState<Record<string, unknown> | null>(null);
    const send = async (outcome: string) => {
        const input = pending ?? { requestId: crypto.randomUUID(), reviewId: review.ref.reviewId, expectedRevision: review.revision, proposalDigest: review.proposalDigest, outcome, summary: summary.trim() || ({ accept: '接受此提案，继续正式适用检查', reject: '拒绝此提案，保留现行规范', defer: '延后此提案，保留现行规范', modify: '提交修改后的新提案，等待重新决定' }[outcome]), description };
        setPending(input);
        setBusy(true);
        try {
            const receipt = await api.decideArchitecture(scope, input);
            setMessage(receipt.status === 'committed' ? '正式回执已落账；下方进度以逐工作事实为准' : '未受理：' + JSON.stringify(receipt));
            setPending(null);
        }
        catch (e) {
            setMessage(errorMessage(e) + '；可用原请求重试以查询同一回执');
        }
        finally {
            setBusy(false);
        }
    };
    return <Paper withBorder p="md" data-testid="architecture-review"><Stack gap="xs">
    <Group><Text fw={600}>架构取舍</Text><Badge>{{ pending: '等待决定', accepted: '已接受', rejected: '已拒绝', deferred: '已延后' }[review.status]}</Badge><Text size="xs">版本 {review.revision}</Text></Group>
    <Text>{row.reportSummary}</Text><Text size="sm">决定说明：{review.summary}</Text>
    <Text size="xs">来源 Run：{review.reporterRunRef.runId} · Plan：{proposal.planRef.planId} · 基线 v{proposal.sourceBaselinePin.ref.revision}：{proposal.sourceBaselinePin.digest}</Text>
    <Text size="xs">提案：{proposal.proposalId} · 摘要：{review.proposalDigest}</Text>
    <Text size="sm">建议方案：{proposal.normalizedContent.description}</Text>
    <Text size="sm">影响模块：{brief.impact.affectedModules.join('、') || '报告未指定'}；接口：{brief.impact.affectedInterfaces.join('、') || '报告未指定'}</Text>
    {brief.options.map(option => <Text size="xs" key={option.optionId}>{option.optionId}：{option.summary} · 风险 {option.risk}</Text>)}
    <Text size="xs">延后影响：{brief.deferralConsequence}</Text>
    <Alert color="blue">涉及新架构取舍的改变等待正式决定，独立工作可按现行规范继续。接受提案后仍需通过迁移、基线激活及当前执行权限检查。</Alert>
    {review.status === 'pending' ? <><Textarea label="决定说明" value={summary} disabled={busy || !!pending} onChange={e => setSummary(e.currentTarget.value)} maxLength={4096}/><Textarea label="修改后的方案说明（修改会产生新提案）" value={description} disabled={busy || !!pending} onChange={e => setDescription(e.currentTarget.value)} maxLength={4096}/><Group>{pending ? <Button loading={busy} onClick={() => void send(String(pending['outcome']))}>重试原请求</Button> : ([['accept', '接受'], ['modify', '修改并重新待决'], ['reject', '拒绝'], ['defer', '延后']] as const).map(([outcome, label]) => <Button key={outcome} disabled={busy} variant={outcome === 'accept' ? 'filled' : 'light'} onClick={() => void send(outcome)}>{label}</Button>)}</Group></> : null}
    {message ? <Text role="status" size="sm">{message}</Text> : null}
    {row.targets.map(t => <Text key={t.workId} size="sm">{t.workId} · {t.mode === 'resume' ? '受影响工作' : '独立工作'} · {{ pending: '待处理', delivered: '已投递', waiting: '等待接续', bound: '已绑定输入', attempted: '已尝试调用', failed: '需处理' }[t.stage]}：{t.reason}{t.runId ? ' · Run ' + t.runId : ''}{t.requestDigest ? ' · 调用 ' + t.requestDigest : ''}</Text>)}
    <Text size="xs">全部已通知：{row.allNotified ? '是' : '否'}；全部受影响工作已有调用采用证据：{row.allRequiredAttempted ? '是' : '否'}</Text>
  </Stack></Paper>;
}
