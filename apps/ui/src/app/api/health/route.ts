import { NextResponse } from "next/server";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export async function GET() {
  try {
    const res = await fetch(`${API}/health`, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json(
        { status: "error", postgres: "down", redis: "down", worker: "down" },
        { status: res.status }
      );
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { status: "error", postgres: "down", redis: "down", worker: "down" },
      { status: 503 }
    );
  }
}
