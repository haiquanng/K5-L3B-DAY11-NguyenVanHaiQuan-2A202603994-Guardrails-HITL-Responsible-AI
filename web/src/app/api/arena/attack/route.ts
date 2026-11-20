import { proxyBackend } from "@/lib/backend";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return proxyBackend(request, "/attack", "POST");
}
