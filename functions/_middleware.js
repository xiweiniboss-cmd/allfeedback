// 所有响应（页面、静态资源、接口）统一加安全头：X-Frame-Options DENY、no-referrer、nosniff、CSP
import { withSecurityHeaders } from '../lib/app.js';
export async function onRequest(context) {
  return withSecurityHeaders(await context.next());
}
