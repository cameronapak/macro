use std::sync::Mutex;

use super::{is_local_stripe_stub, local_stripe_customer_id};

/// Tests mutate the process env, which is process-global; serialize them so
/// they can't interleave.
static ENV_LOCK: Mutex<()> = Mutex::new(());

fn with_stripe_key(key: Option<&str>, f: impl FnOnce()) {
    let _guard = ENV_LOCK.lock().unwrap();
    let saved = std::env::var("STRIPE_SECRET_KEY").ok();
    match key {
        Some(key) => unsafe { std::env::set_var("STRIPE_SECRET_KEY", key) },
        None => unsafe { std::env::remove_var("STRIPE_SECRET_KEY") },
    };
    f();
    match saved {
        Some(saved) => unsafe { std::env::set_var("STRIPE_SECRET_KEY", saved) },
        None => unsafe { std::env::remove_var("STRIPE_SECRET_KEY") },
    };
}

#[test]
fn local_stub_key_is_detected() {
    with_stripe_key(Some("local-stripe-secret"), || {
        assert!(is_local_stripe_stub());
    });
}

#[test]
fn real_key_is_not_detected_as_stub() {
    with_stripe_key(Some("sk_live_real_key"), || {
        assert!(!is_local_stripe_stub());
    });
}

#[test]
fn missing_key_is_not_detected_as_stub() {
    with_stripe_key(None, || {
        assert!(!is_local_stripe_stub());
    });
}

#[test]
fn local_stripe_customer_id_is_unique_per_email() {
    let alice = local_stripe_customer_id("alice@seed.macro.local");
    let bob = local_stripe_customer_id("bob@seed.macro.local");
    assert_ne!(alice, bob);
    assert!(alice.contains("alice@seed.macro.local"));
}
