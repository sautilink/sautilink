import { createHandler } from "./core.ts";
import { createRuntime } from "./runtime.ts";

Deno.serve(createHandler(createRuntime((name) => Deno.env.get(name))));
