import type { GatewayRequestHandlers } from "./types.js";
import { cancelJob, getJob, listJobs, type JobStatus } from "../../agents/jobs.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateJobsCancelParams,
  validateJobsGetParams,
  validateJobsListParams,
} from "../protocol/index.js";

export const jobsHandlers: GatewayRequestHandlers = {
  "jobs.list": ({ params, respond }) => {
    const filter = (params ?? {}) as { agent?: string; status?: JobStatus; limit?: number };
    if (params !== undefined && !validateJobsListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid jobs.list params: ${formatValidationErrors(validateJobsListParams.errors)}`,
        ),
      );
      return;
    }
    respond(true, {
      jobs: listJobs({ agent: filter.agent, status: filter.status, limit: filter.limit }),
    });
  },

  "jobs.get": ({ params, respond }) => {
    if (!validateJobsGetParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid jobs.get params: ${formatValidationErrors(validateJobsGetParams.errors)}`,
        ),
      );
      return;
    }
    const { id } = params as { id: string };
    const job = getJob(id);
    if (!job) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `job not found: ${id}`));
      return;
    }
    respond(true, { job });
  },

  "jobs.cancel": ({ params, respond, client }) => {
    if (!validateJobsCancelParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid jobs.cancel params: ${formatValidationErrors(validateJobsCancelParams.errors)}`,
        ),
      );
      return;
    }
    const { id } = params as { id: string };
    const requestedBy = client?.connect?.device?.id ?? "operator";
    const result = cancelJob(id, { requestedBy });
    if (!result.ok && result.reason === "not_found") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `job not found: ${id}`));
      return;
    }
    respond(result.ok, result.ok ? { job: result.job } : { reason: result.reason });
  },
};
