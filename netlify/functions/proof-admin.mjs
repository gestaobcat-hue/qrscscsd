import adminHandlerModule from "../lib/proof-admin-handler.js";
import { runLambdaHandler } from "../lib/modern-function-adapter.mjs";

export default async (request) => runLambdaHandler(request, adminHandlerModule.handler);
