import indexHTML from "index.html";

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
      case "/do-websocket":
        return forward();
    }
    return new Response("Not Found", { status: 404 });
  },
};

class IntervalsTestDO implements DurableObject {
  private readonly _doID: string;

  constructor() {
    this._doID = crypto.randomUUID();
  }

  async fetch(request: Request): Promise<Response> {
    console.log("IntervalsTestDO fetch", request.url);
    const url = new URL(request.url);
    switch (url.pathname) {
      case "/do-websocket":
        return handleWebSocketConnect(request, this._doID);
    }
    return new Response("Not Found", { status: 404 });
  }
}

async function handleWebSocketConnect(
  request: Request,
  serverID: string
): Promise<Response> {
  if (request.headers.get("Upgrade") !== "websocket") {
    return new Response("expected websocket", { status: 400 });
  }
  const url = new URL(request.url);
  const work = parseInt(url.searchParams.get("work") ?? "0");
  const pair = new WebSocketPair();
  const ws = pair[1];
  ws.accept();
  ws.send("connected");
  let i = 0;
  const intervalID = setInterval(() => {
    console.log("interval tick", i);
    i++;
    ws.send(createResponseBody(serverID, i, Date.now()));
    if (i >= 100) {
      clearInterval(intervalID);
    }
    doWork(work);
  }, 250);
  return new Response(null, { status: 101, webSocket: pair[0] });
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
