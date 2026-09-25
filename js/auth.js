/* ============================================================
   NextUp Bill Pay Ledger — Auth (Supabase-backed)
   Wraps Supabase Auth + the `profiles` table (see
   supabase/schema.sql) behind the same function names the app
   already calls, so app.js / dashboard pages didn't need to
   change shape — every function here is now async, though.
   ============================================================ */

const NextUpAuth = (() => {
  const TRIAL_DAYS = 7;

  function mapUser(authUser, profileRow) {
    if (!authUser) return null;
    const p = profileRow || {};
    return {
      id: authUser.id,
      email: authUser.email || '',
      name: p.name || (authUser.user_metadata && authUser.user_metadata.name) || '',
      subscribed: !!p.subscribed,
      status: p.status || 'new',
      plan: p.plan || null,
      isOwner: !!p.is_owner,
      trialStartedAt: p.trial_started_at || null,
      trialEndsAt: p.trial_ends_at || null,
      createdAt: p.created_at || authUser.created_at
    };
  }

  async function fetchProfileRow(userId) {
    const { data, error } = await supabaseClient.from('profiles').select('*').eq('id', userId).single();
    if (error) return null;
    return data;
  }

  // If a trial has run past its trialEndsAt date, flip the profile back to
  // unsubscribed so requireSubscription() sends them to checkout again.
  async function applyTrialExpiry(user) {
    if (user.status === 'trialing' && user.trialEndsAt && new Date(user.trialEndsAt) <= new Date()) {
      await supabaseClient.from('profiles').update({ status: 'expired', subscribed: false }).eq('id', user.id);
      user.status = 'expired';
      user.subscribed = false;
    }
    return user;
  }

  async function currentUser() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return null;
    const profileRow = await fetchProfileRow(session.user.id);
    let user = mapUser(session.user, profileRow);
    user = await applyTrialExpiry(user);
    return user;
  }

  async function signUp(name, email, password) {
    email = (email || '').trim().toLowerCase();
    if (!name || !email || !password) return { ok: false, error: 'Fill in every field.' };
    const { data, error } = await supabaseClient.auth.signUp({
      email, password, options: { data: { name } }
    });
    if (error) return { ok: false, error: error.message };
    if (!data.session) return { ok: false, error: 'Check your email to confirm your account, then log in.' };
    return { ok: true };
  }

  async function logIn(email, password) {
    email = (email || '').trim().toLowerCase();
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, error: 'Incorrect email or password.' };
    return { ok: true };
  }

  async function logOut() {
    await supabaseClient.auth.signOut();
  }

  // Requires "Allow anonymous sign-ins" enabled in Supabase Auth settings.
  async function continueAsGuest() {
    const { data, error } = await supabaseClient.auth.signInAnonymously();
    if (error) return { ok: false, error: error.message };
    await supabaseClient.from('profiles')
      .update({ name: 'Guest', subscribed: true, status: 'demo', plan: 'demo' })
      .eq('id', data.user.id);
    return { ok: true };
  }

  async function markSubscribed(userId, plan) {
    await supabaseClient.from('profiles').update({
      subscribed: true, status: 'active', plan: plan || 'monthly'
    }).eq('id', userId);
  }

  async function startTrial(userId, plan) {
    const now = new Date();
    const trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
    await supabaseClient.from('profiles').update({
      subscribed: true, status: 'trialing', plan: plan || 'monthly',
      trial_started_at: now.toISOString(), trial_ends_at: trialEndsAt.toISOString()
    }).eq('id', userId);
  }

  // ---- page guards ----
  async function requireAuth(redirectTo) {
    const user = await currentUser();
    if (!user) { window.location.href = redirectTo || 'login.html'; return null; }
    return user;
  }

  async function requireSubscription(checkoutPage) {
    const user = await requireAuth();
    if (!user) return null;
    if (!user.subscribed) { window.location.href = checkoutPage || 'checkout.html'; return null; }
    return user;
  }

  return {
    signUp, logIn, logOut, continueAsGuest, markSubscribed, startTrial,
    currentUser, requireAuth, requireSubscription, TRIAL_DAYS
  };
})();
