/**
 * The note body rendering shared by the read model and the writer. It carries
 * no dependencies, so neither side has to import the other.
 */

/** The stored body of an understanding is the rendered five sections (L4.1). */
export function renderUnderstandingBody(sections: { status: string; decided: string; open: string; next: string; risks: string }): string {
  return `现状\n${sections.status}\n\n已定\n${sections.decided}\n\n未决\n${sections.open}\n\n下一步\n${sections.next}\n\n风险\n${sections.risks}`;
}
