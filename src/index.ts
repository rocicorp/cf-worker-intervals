import { consoleLogSink, LogContext, TeeLogSink } from "@rocicorp/logger";
import { DatadogLogSink } from "./datadog-log-sink";

export interface Env {
  clocksTestDO: DurableObjectNamespace;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  DATADOG_API_KEY?: string;
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    console.log("worker fetch");
    let url = new URL(request.url);
    if (url.pathname !== "/connect") {
      return new Response("unknown route", {
        status: 400,
      });
    }
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 400 });
    }
    console.log("forwarding connect");
    return env.clocksTestDO
      .get(env.clocksTestDO.idFromName("clock-tests-singleton"))
      .fetch(request);
  },
};

class ClocksTestDO implements DurableObject {
  private readonly _lc: LogContext;
  private readonly _doStart: number;
  constructor(_state: DurableObjectState, env: Env) {
    const logSinks = [consoleLogSink];
    if (env.DATADOG_API_KEY) {
      logSinks.push(
        new DatadogLogSink({
          apiKey: env.DATADOG_API_KEY,
          service: "cf-worker-clocks-do",
        })
      );
    }
    this._lc = new LogContext("info", new TeeLogSink(logSinks));
    this._doStart = Date.now();
    this._lc.info?.("DO created", this._doStart);
  }

  async fetch(request: Request): Promise<Response> {
    console.log("DO fetch");

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 400 });
    }
    const pair = new WebSocketPair();
    const ws = pair[1];
    const url = new URL(request.url);
    const name = url.searchParams.get("name");
    const workPerMessage = parseInt(url.searchParams.get("work") ?? "0");
    const lc = this._lc.addContext("name", name);
    ws.accept();
    ws.send("connected");
    let start: number | undefined;
    let last: number | undefined;
    let clientStart: number | undefined;
    let clientLast: number | undefined;
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data.toString());
      const now = Date.now();
      ws.send(JSON.stringify([message[0], now]));
      const clientNow: number = message[0];
      if (start === undefined) {
        start = now;
      }
      if (last == undefined) {
        last = start;
      }
      if (clientStart === undefined) {
        clientStart = clientNow;
      }
      if (clientLast === undefined) {
        clientLast = clientStart;
      }
      lc.info?.(
        "server",
        now,
        "client",
        message[0],
        "server-client",
        (now - message[0]).toString().padStart(5, " "),
        "server since last",
        (now - last).toString().padStart(5, " "),
        "server since start",
        (now - start).toString().padStart(7, " "),
        "client since last",
        (clientNow - clientLast).toString().padStart(5, " "),
        "client since start",
        (clientNow - clientStart).toString().padStart(7, " "),
        "do since start",
        (now - this._doStart).toString().padStart(7, " ")
      );
      last = now;
      clientLast = clientNow;
      let result = 1;
      for (let i = 0; i < workPerMessage; i++) {
        for (let j = 0; j < workPerMessage; j++) {
          result = result + i * j + crypto.randomUUID().length;
        }
      }
    });
    ws.addEventListener("close", (e) => {
      lc.info?.("WebSocket CloseEvent for client", {
        reason: e.reason,
        code: e.code,
        wasClean: e.wasClean,
      });
    });
    ws.addEventListener("error", (e) => {
      lc.error?.(
        "WebSocket ErrorEvent for client",
        Date.now(),
        {
          filename: e.filename,
          message: e.message,
          lineno: e.lineno,
          colno: e.colno,
        },
        e.error
      );
    });
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
}

export { worker as default, ClocksTestDO };
