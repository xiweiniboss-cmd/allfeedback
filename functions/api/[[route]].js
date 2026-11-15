// 所有 /api/* 交给 lib/app.js
import { handleApi } from '../../lib/app.js';
export async function onRequest(context) {
  return handleApi(context.request, context.env);
}
