import proofsHandlerModule from "../lib/proofs-handler.js";
import { runLambdaHandler } from "../lib/modern-function-adapter.mjs";

export default async (request) => runLambdaHandler(request, proofsHandlerModule.handler);
