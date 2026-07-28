import type { ExtensionHandler, SessionContext } from "@earendil-works/pi-coding-agent";

export interface SessionEstablishedEvent {
  type: "session_established";
  reason: "new" | "resume";
  ctx: SessionContext;
}

declare module "@earendil-works/pi-coding-agent" {
  interface ExtensionRunner {
    emit(event: SessionEstablishedEvent): Promise<undefined>;
  }

  interface ExtensionAPI {
    on(event: "session_established", handler: ExtensionHandler<SessionEstablishedEvent>): void;
  }
}
