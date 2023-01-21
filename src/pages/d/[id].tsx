import { useEffect } from "react";

export const workerWsURI =
  process.env.NEXT_PUBLIC_WORKER_HOST ??
  "wss://cf-worker-clocks-test.replicache.workers.dev";

declare global {
  const location: URL;
}

export default function Home() {
  useEffect(() => {
    const [, , name] = location.pathname.split("/");
    const work = new URL(location.href).searchParams.get("work") ?? "0";
    const url = new URL(workerWsURI);
    url.pathname = "/connect";
    const { searchParams } = url;
    searchParams.set("name", name);
    searchParams.set("work", work);
    const ws = new WebSocket(url.toString());
    ws.addEventListener("message", async (e: MessageEvent<string>) => {
      if (e.data === "connected") {
        setInterval(() => {
          const now = Date.now();
          ws.send(JSON.stringify([now]));
        }, 250);
      } else if (typeof e.data === "string") {
        const now = Date.now();
        const jsonData = JSON.parse(e.data);
        console.log("round-trip", now - jsonData[0]);
      }
    });
    ws.addEventListener("close", async (e: CloseEvent) => {
      console.log(e);
    });
  }, []);
  return <div>Cf Worker Clocks Test</div>;
}
