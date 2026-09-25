import { NextResponse } from "next/server";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export async function GET() {
  try {
    const res = await fetch(`${API}/api/queues`, { cache: "no-store" });
    if (!res.ok) return NextResponse.json(null, { status: 502 });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json(null, { status: 503 });
  }
}
