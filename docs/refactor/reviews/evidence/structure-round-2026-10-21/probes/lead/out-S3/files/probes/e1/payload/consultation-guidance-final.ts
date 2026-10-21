/**
 * Copy-only extraction of the consultation guidance expression in the S3
 * result tree (`consultation.ts:449–451`). The inline call became a
 * `renderTemplate` call; this function builds exactly the same slot values and
 * returns the same `.text`, so both copies record identical args/out.
 */
function consultationGuidanceTextImpl(messageId: string, sourceRef: unknown): string {
  return renderTemplate(PLATFORM_PROMPT_PACK_V1, 'consultation-received-input', {
    messageId,
    sourceJson: JSON.stringify(sourceRef),
  }, []).text;
}

function consultationGuidanceText(messageId: string, sourceRef: unknown): string {
  const out = consultationGuidanceTextImpl(messageId, sourceRef);
  probe('consultation.guidance', [messageId, sourceRef], out);
  return out;
}

/** Replay/edge entry point: runs the same body without recording. */
export function probeConsultationGuidanceText(messageId: string, sourceRef: unknown): string {
  return consultationGuidanceTextImpl(messageId, sourceRef);
}
