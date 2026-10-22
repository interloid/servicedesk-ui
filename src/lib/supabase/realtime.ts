import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

type SubscribeCallback = Parameters<RealtimeChannel["subscribe"]>[0];

/**
 * Join `channel` once the socket carries the signed-in user's token.
 *
 * A channel joins with whatever token the socket holds at that moment, and
 * realtime evaluates RLS with the claims it joined with for as long as the
 * subscription lives. Joining straight away from a layout's first effect --
 * before the browser client has read the session cookie, or after a sign-in
 * done by a server action, which the browser client never hears about --
 * joins as `anon`, and every row is silently filtered out. setAuth() with no
 * argument re-reads the session (falling back to the anon key when there is
 * none) and hands it to the socket first.
 *
 * Returns the cleanup: it also stops a join still waiting on the token.
 */
export function subscribeWithAuth(
  supabase: SupabaseClient,
  channel: RealtimeChannel,
  callback?: SubscribeCallback,
): () => void {
  let removed = false;

  void supabase.realtime
    .setAuth()
    .catch((error: unknown) => {
      console.warn("[realtime] could not refresh the socket token:", error);
    })
    .then(() => {
      if (!removed) channel.subscribe(callback);
    });

  return () => {
    removed = true;
    void supabase.removeChannel(channel);
  };
}
