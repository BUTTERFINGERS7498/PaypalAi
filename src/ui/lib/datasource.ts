import { createHttpApi } from "./http";
import { createMockApi } from "./mock";
import type { Api } from "./types";

// ONE data-source switch.
//  NEXT_PUBLIC_DATA_SOURCE=mock|api wins if set.
//  Otherwise: api when NEXT_PUBLIC_API_URL is set (even ""), and api in production builds
//  (the console is served by the backend, same origin); mock only in `next dev` with nothing set.
function pick(): "mock" | "api" {
  const ds = process.env.NEXT_PUBLIC_DATA_SOURCE;
  if (ds === "mock" || ds === "api") return ds;
  if (process.env.NEXT_PUBLIC_API_URL !== undefined) return "api";
  return process.env.NODE_ENV === "production" ? "api" : "mock";
}

let instance: Api | null = null;
export function getApi(): Api {
  if (!instance) instance = pick() === "mock" ? createMockApi() : createHttpApi();
  return instance;
}
