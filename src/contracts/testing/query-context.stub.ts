/** P1-09 stub query-context compiler (lane fills); throws "not implemented yet" so the
 * isP109Ready probe stays false until the lane lands. */
import type { QueryContextPort, QueryContextRequestV1, QueryContextResultV1 } from "../query-job.js";

export class QueryJobContextStub implements QueryContextPort {
  assembleQueryContext(request: QueryContextRequestV1): Promise<QueryContextResultV1> {
    void request;
    throw new Error("P1-09 lane: query-context assembly not implemented yet");
  }
}
