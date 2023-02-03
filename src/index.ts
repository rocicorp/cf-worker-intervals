import indexHTML from "index.html";

const INTERVAL_MS = 1000;

export interface Env {
  intervalsTestDO: DurableObjectNamespace;
}

const worker = {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    let workerID = globalThis.workerID;
    if (workerID === undefined) {
      workerID = crypto.randomUUID();
      globalThis.workerID = workerID;
    }
    const url = new URL(request.url);
    const forward = () => {
      return env.intervalsTestDO
        .get(env.intervalsTestDO.idFromName("interval-tests-singleton"))
        .fetch(request);
    };
    switch (url.pathname) {
      case "/":
        return new Response(indexHTML, {
          headers: {
            "content-type": "text/html;charset=UTF-8",
          },
        });
      case "/connect":
        return forward();
    }
    return new Response("Not Found", { status: 404 });
  },
};

class IntervalsTestDO implements DurableObject {
  private readonly _doID: string;
  private readonly _state: DurableObjectState;
  private _ws: WebSocket | undefined;
  private _work: number = 0;
  private _startTimestamp: number = 0;
  private _i: number = 0;

  constructor(state: DurableObjectState) {
    this._doID = crypto.randomUUID();
    this._state = state;
  }

  async fetch(request: Request): Promise<Response> {
    console.log("IntervalsTestDO fetch", request.url);
    const url = new URL(request.url);
    switch (url.pathname) {
      case "/connect":
        return this.handleWebSocketConnect(request);
    }
    return new Response("Not Found", { status: 404 });
  }

  async alarm(): Promise<void> {
    this._i++;
    console.log("alarm tick", this._i);
    this._ws?.send(createResponseBody(this._doID, this._i, Date.now()));
    if (this._i >= 50) {
      this._i = 0;
      this._startTimestamp = 0;
      this._ws?.close();
      this._ws = undefined;
    } else {
      this._state.storage.setAlarm(
        this._startTimestamp + this._i * INTERVAL_MS + INTERVAL_MS
      );
      doWork(this._work);
    }
  }

  async handleWebSocketConnect(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 400 });
    }
    const url = new URL(request.url);
    const work = parseInt(url.searchParams.get("work") ?? "0");
    const test = url.searchParams.get("test") ?? "do-interval";
    const pair = new WebSocketPair();
    const ws = pair[1];
    ws.accept();
    ws.send("connected");
    switch (test) {
      case "do-interval": {
        let i = 0;
        const intervalID = setInterval(() => {
          i++;
          console.log("interval tick", i);
          ws.send(createResponseBody(this._doID, i, Date.now()));
          if (i >= 50) {
            clearInterval(intervalID);
            ws.close();
            return;
          }
          doWork(work);
        }, INTERVAL_MS);
        break;
      }
      case "do-timeout": {
        let i = 0;
        const timeoutHandler = () => {
          i++;
          console.log("timeout tick", i);
          ws.send(createResponseBody(this._doID, i, Date.now()));
          if (i >= 50) {
            ws.close();
            return;
          }
          setTimeout(timeoutHandler, INTERVAL_MS);
          doWork(work);
        };
        setTimeout(timeoutHandler, INTERVAL_MS);
        break;
      }
      case "do-alarm": {
        this._ws = ws;
        this._startTimestamp = Date.now();
        this._i = 0;
        this._work = work;
        this._state.storage.setAlarm(this._startTimestamp + INTERVAL_MS);
      }
    }

    return new Response(null, { status: 101, webSocket: pair[0] });
  }
}

function createResponseBody(
  serverID: string,
  i: number,
  serverTimestamp: number
) {
  return JSON.stringify({ serverID, i, serverTimestamp });
}

function doWork(work: number) {
  let result = 1;
  for (let i = 0; i < work; i++) {
    result = result + i * i + crypto.randomUUID().length;
  }
  return result;
}

export { worker as default, IntervalsTestDO };
