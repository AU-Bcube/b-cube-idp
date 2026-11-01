/**
 * 내 동의 관리: 동의한 SP별로 제공하는 정보를 보여주고 동의를 철회한다.
 * 학교 Google 계정으로 로그인한 본인의 동의만 볼 수 있다.
 */
import { Hono } from "hono";
import { clearAccountSession, loadAccountSession } from "../account-session";
import { findClient } from "../clients";
import { deleteConsent, listConsents } from "../consents";
import { timingSafeEqual } from "../crypto";
import { errorPage, startGoogleLogin } from "../respond";
import type { HonoEnv } from "../types";
import { ConsentsPage, type ConsentEntry } from "../views";
import { sameOrigin } from "./login";

export const consentsRoutes = new Hono<HonoEnv>()
  .get("/login", (c) => startGoogleLogin(c, { account: true }))
  .use("*", async (c, next) => {
    const session = await loadAccountSession(c);
    if (!session) {
      if (c.req.method === "GET") return c.redirect("/consents/login", 302);
      return errorPage(c, 403, "로그인이 필요합니다", "내 동의 관리에 다시 로그인해 주세요.");
    }
    c.set("account", session);
    if (c.req.method === "POST") {
      const form = await c.req.parseBody();
      if (typeof form.csrf !== "string" || !timingSafeEqual(form.csrf, session.csrf) || !sameOrigin(c)) {
        return errorPage(c, 403, "잘못된 요청", "요청이 만료되었거나 다른 사이트에서 보낸 요청입니다.");
      }
      c.set("form", form);
    }
    await next();
  })
  .get("/", async (c) => {
    const { config } = c.var;
    const account = c.var.account;
    const entries: ConsentEntry[] = await Promise.all(
      (await listConsents(c.env.DB, account.sub)).map(async (consent) => {
        const client = await findClient(c.env.DB, consent.clientId);
        return {
          ...consent,
          clientName: client?.name ?? null,
          origins: [...new Set((client?.redirectUris ?? []).map((u) => new URL(u).origin))],
        };
      }),
    );
    const revokedId = c.req.query("revoked");
    const revoked = revokedId ? ((await findClient(c.env.DB, revokedId))?.name ?? revokedId) : undefined;
    return c.html(<ConsentsPage account={account} csrf={account.csrf} entries={entries} revoked={revoked} />);
  })
  .post("/revoke", async (c) => {
    const clientId = c.var.form.client_id;
    if (typeof clientId !== "string" || !clientId) return errorPage(c, 400, "잘못된 요청", "철회할 서비스를 고르세요.");
    await deleteConsent(c.env.DB, c.var.account.sub, clientId);
    return c.redirect(`/consents?revoked=${encodeURIComponent(clientId)}`, 302);
  })
  .post("/logout", (c) => {
    clearAccountSession(c);
    return c.redirect("/", 302);
  });
