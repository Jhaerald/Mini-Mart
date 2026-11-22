/*
 * ============================================================================
 * checkout.js - CHECKOUT FORM + ORDER SUMMARY module
 * ============================================================================
 *
 * WHAT THIS FILE DOES
 *   1. Draws the "Your order" panel (items + total) on the checkout screen.
 *   2. Validates the delivery form (name, email, phone, address).
 *   3. When the form is valid and the cart is not empty, it builds an
 *      "order" object, clears the form and cart, and ANNOUNCES the order.
 *
 * EVENTS
 *   LISTENS  "cart-updated"       -> redraw the order summary
 *   LISTENS  "checkout-requested" -> redraw the order summary
 *   LISTENS  "view-changed"       -> when the checkout view opens, refresh it
 *   SENDS    "order-placed"       -> event.detail = the full order object
 *                                    (main.js shows the confirmation screen)
 *
 * This file never switches screens itself. It only announces "order-placed".
 * main.js decides what to do about it.
 */

"use strict";

// ----------------------------------------------------------------------------
// THE IIFE WRAPPER  ( function () { ... } )();
// ----------------------------------------------------------------------------
// IIFE = Immediately Invoked Function Expression. We define a function and
// call it straight away. Every variable inside is PRIVATE to this file, so
// names like `fields` or `formatCurrency` can't clash with other scripts
// (remember: top-level names of classic scripts all share one global scope).
// Only what we deliberately attach to `window` (window.CheckoutModule at the
// bottom) is visible to the outside.
(function () {

  // ==========================================================================
  // 1. SELECT THE HTML ELEMENTS
  // ==========================================================================
  const checkoutForm = document.getElementById("checkout-form");
  const orderItemsList = document.getElementById("order-items");        // <ul> of items
  const orderTotalEl = document.getElementById("order-total");          // the big total number
  const checkoutEmptyEl = document.getElementById("checkout-empty");    // "Your cart is empty."
  const checkoutMessageEl = document.getElementById("checkout-message"); // general form message
  const placeOrderBtn = document.getElementById("place-order");


  // ==========================================================================
  // 2. FIELD DEFINITIONS  (data-driven validation)
  // ==========================================================================
  // Every form field is described by ONE object with three things:
  //    input    -> the <input> element
  //    error    -> the <p> where its error text appears
  //    validate -> a function that gets the typed value and returns
  //                an error message string, or "" (empty) when the value is OK
  //
  // Why this design is good: the loops further down work on ALL fields
  // automatically. To add a new field (e.g. postcode) you add ONE entry here,
  // plus its HTML. No other code needs changing.
  const fields = {
    fullName: {
      input: document.getElementById("fullName"),
      error: document.getElementById("fullName-error"),
      validate(value) {
        // .trim() removes spaces at both ends, so "   " counts as empty.
        if (!value.trim()) return "Please enter your full name.";
        if (value.trim().length < 2) return "Name must be at least 2 characters.";
        return ""; // "" means: no error, value is valid
      }
    },

    email: {
      input: document.getElementById("email"),
      error: document.getElementById("email-error"),
      validate(value) {
        const trimmed = value.trim();
        if (!trimmed) return "Please enter your email address.";

        // REGEX (regular expression) explained piece by piece:
        //   ^        start of the text
        //   [^\s@]+  one or more characters that are NOT whitespace and NOT "@"
        //   @        a literal "@"
        //   [^\s@]+  one or more non-space, non-@ characters (the domain)
        //   \.       a literal dot
        //   [^\s@]+  one or more non-space, non-@ characters (e.g. "com")
        //   $        end of the text
        // So "ada@mail.com" passes; "ada@mail" and "ada mail.com" fail.
        // It's a quick sanity check, not a perfect one. That's fine on the
        // front end, because the real check belongs on a server.
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
          return "Please enter a valid email address.";
        }
        return "";
      }
    },

    phone: {
      input: document.getElementById("phone"),
      error: document.getElementById("phone-error"),
      validate(value) {
        // \D means "any character that is NOT a digit". Replacing all of them
        // with "" leaves only the digits, so "+234 801-234-5678" -> "2348012345678".
        // The "g" flag means "replace every match", not just the first.
        const digits = value.replace(/\D/g, "");
        if (!value.trim()) return "Please enter your phone number.";
        if (digits.length < 7) return "Please enter a valid phone number.";
        return "";
      }
    },

    address: {
      input: document.getElementById("address"),
      error: document.getElementById("address-error"),
      validate(value) {
        if (!value.trim()) return "Please enter your delivery address.";
        if (value.trim().length < 5) return "Please enter a complete delivery address.";
        return "";
      }
    }
  };


  // ==========================================================================
  // 3. HELPERS
  // ==========================================================================

  // Read the current cart in a safe way. It is a FALLBACK CHAIN:
  //   1st choice: window.MiniMartStore (the bridge that main.js creates)
  //   2nd choice: the global `cart` from cart.js
  //   last resort: an empty cart
  //
  // WHY the fallbacks matter: the scripts run in order
  // products -> cart -> checkout -> main. When checkout.js runs its very first
  // render (last line of this file), main.js has NOT run yet, so
  // window.MiniMartStore does not exist yet. Without the fallback this would crash.
  //
  // Always returns the same shape: { items: [...], total: number }
  function getCartSnapshot() {
    if (window.MiniMartStore && typeof window.MiniMartStore.getItems === "function") {
      return {
        items: window.MiniMartStore.getItems(),
        total: window.MiniMartStore.getTotal()
      };
    }
    // `typeof x !== "undefined"` is the SAFE way to ask "does x exist?".
    // Just writing `cart` when it doesn't exist would throw a ReferenceError.
    if (typeof cart !== "undefined") {
      return {
        items: cart.getItems(),
        total: cart.getTotal()
      };
    }
    return { items: [], total: 0 };
  }

  // 12.5 -> "$12.50"
  // (The same function also exists in main.js and products.js. It is kept here
  // so this file stays self-contained. See README for a cleaner idea.)
  function formatCurrency(amount) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD"
    }).format(amount);
  }


  // ==========================================================================
  // 4. DRAW THE "YOUR ORDER" PANEL
  // ==========================================================================
  function renderCheckoutSummary() {
    // GUARD CLAUSE: if the elements are missing, quit quietly instead of crashing.
    if (!orderItemsList || !orderTotalEl) return;

    // Destructuring: pull `items` and `total` out of the returned object.
    const { items, total } = getCartSnapshot();

    // Clear old rows first so items are never duplicated.
    orderItemsList.replaceChildren();

    // ----- Case A: the cart is empty -----
    if (items.length === 0) {
      if (checkoutEmptyEl) checkoutEmptyEl.hidden = false;  // show "Your cart is empty."
      if (placeOrderBtn) placeOrderBtn.disabled = true;     // can't order nothing
      orderTotalEl.textContent = formatCurrency(0);
      return; // stop here
    }

    // ----- Case B: the cart has items -----
    if (checkoutEmptyEl) checkoutEmptyEl.hidden = true;
    if (placeOrderBtn) placeOrderBtn.disabled = false;

    items.forEach((item) => {
      // One <li> per item:   "2 x Smart Watch ........ $258.00"
      const li = document.createElement("li");
      li.className = "summary-item";

      const nameSpan = document.createElement("span");
      nameSpan.className = "summary-item__name";
      // textContent (NOT innerHTML) = text only, never parsed as HTML. Safe.
      nameSpan.textContent = `${item.quantity} × ${item.title}`;

      const priceSpan = document.createElement("span");
      priceSpan.className = "summary-item__price";
      priceSpan.textContent = formatCurrency(item.price * item.quantity);

      li.append(nameSpan, priceSpan);
      orderItemsList.append(li);
    });

    orderTotalEl.textContent = formatCurrency(total);
  }


  // ==========================================================================
  // 5. VALIDATION FUNCTIONS
  // ==========================================================================

  // Validate ONE field (looked up by its key in the `fields` object).
  // Shows or clears its error message and returns true (valid) / false (invalid).
  function validateField(key) {
    const field = fields[key];

    // If the field's HTML is missing, don't block the whole form.
    if (!field || !field.input || !field.error) return true;

    const message = field.validate(field.input.value);
    field.error.textContent = message; // "" clears the error, text shows it

    // classList.toggle(name, force): add the class if `force` is true,
    // remove it if false. Boolean("") is false; Boolean("some text") is true.
    // The "invalid" class turns the input red (see checkout.css).
    field.input.classList.toggle("invalid", Boolean(message));

    return !message; // no message = valid
  }

  // Validate EVERY field. We deliberately do NOT stop at the first error:
  // running all of them lets the user see ALL their mistakes at once.
  function validateAllFields() {
    let allValid = true;
    Object.keys(fields).forEach((key) => {  // keys: "fullName", "email", "phone", "address"
      if (!validateField(key)) {
        allValid = false;
      }
    });
    return allValid;
  }

  // Show a general message under the form. `type` is "error" or "success"
  // (or "" to just clear it) and decides the colour through a CSS class.
  function setFormMessage(text, type) {
    if (!checkoutMessageEl) return;
    checkoutMessageEl.textContent = text;
    // Always reset to the base class, then add the type class if there is one.
    checkoutMessageEl.className = "form-message" + (type ? ` ${type}` : "");
  }


  // ==========================================================================
  // 6. REAL-TIME VALIDATION (while the user types)
  // ==========================================================================
  // Loop over every field and attach two listeners to its input.
  Object.keys(fields).forEach((key) => {
    const field = fields[key];
    if (!field.input) return;

    // "blur" = the user LEFT the field -> check it.
    field.input.addEventListener("blur", () => validateField(key));

    // "input" = the user typed something. We only re-check if the field is
    // ALREADY marked invalid. That's friendly UX: we don't scold someone
    // mid-way through typing, but once an error is showing, it disappears the
    // moment they fix it.
    field.input.addEventListener("input", () => {
      if (field.input.classList.contains("invalid")) {
        validateField(key);
      }
    });
  });


  // ==========================================================================
  // 7. THE SUBMIT HANDLER - the core of this file
  // ==========================================================================
  if (checkoutForm) {
    checkoutForm.addEventListener("submit", (event) => {
      // Stop the browser's default behaviour (reloading the page with form data).
      event.preventDefault();
      setFormMessage("", ""); // clear any old message

      // ----- Step 1: is there anything to buy? -----
      // We read the cart NOW and keep `items` and `total` for the order below.
      const { items, total } = getCartSnapshot();
      if (items.length === 0) {
        setFormMessage("Your cart is empty. Add items before placing an order.", "error");
        return;
      }

      // ----- Step 2: is the form valid? -----
      if (!validateAllFields()) {
        setFormMessage("Please fix the highlighted errors above before placing your order.", "error");

        // Move keyboard focus to the first bad field (helps keyboard and
        // screen reader users). .querySelector returns the first match.
        const firstInvalid = checkoutForm.querySelector(".invalid");
        if (firstInvalid) firstInvalid.focus();
        return;
      }

      // ----- Step 3: build the order object -----
      // This is the data main.js will use to draw the confirmation screen.
      const orderData = {
        // Random 6-digit number: Math.random() is 0..0.999, so
        // 100000 + (0..0.999 x 900000) -> 100000..999999. floor() drops decimals.
        // NOTE: fine for a demo, but a real shop gets IDs from its server.
        orderId: "MM-" + Math.floor(100000 + Math.random() * 900000),

        // e.g. "Nov 19, 2026, 3:45 PM"
        placedAt: new Date().toLocaleString("en-US", {
          dateStyle: "medium",
          timeStyle: "short"
        }),

        // Typed values, trimmed of stray spaces.
        customer: {
          fullName: fields.fullName.input.value.trim(),
          email: fields.email.input.value.trim(),
          phone: fields.phone.input.value.trim(),
          address: fields.address.input.value.trim()
        },

        // Shorthand for `items: items, total: total`.
        // These are COPIES (cart.getItems() returns copies), so clearing the
        // cart in a moment will not empty this order.
        items,
        total
      };

      setFormMessage("Order placed successfully!", "success");

      // ----- Step 4: reset the form -----
      // reset() empties the inputs, but it does NOT remove our error text or
      // the "invalid" class, so we clean those by hand.
      checkoutForm.reset();
      Object.keys(fields).forEach((key) => {
        if (fields[key].input) fields[key].input.classList.remove("invalid");
        if (fields[key].error) fields[key].error.textContent = "";
      });

      // ----- Step 5: empty the shared cart -----
      // Same fallback idea as getCartSnapshot: bridge first, `cart` second.
      if (window.MiniMartStore && typeof window.MiniMartStore.clear === "function") {
        window.MiniMartStore.clear();
      } else if (typeof cart !== "undefined") {
        cart.clear();
      }

      // ----- Step 6: ANNOUNCE the order -----
      // Notify main.js so it can switch to the Order Summary / Confirmation view.
      // We pass the order inside `detail`. main.js listens for "order-placed".
      document.dispatchEvent(
        new CustomEvent("order-placed", {
          detail: orderData
        })
      );
    });
  }


  // ==========================================================================
  // 8. KEEP THE SUMMARY IN SYNC
  // ==========================================================================
  // Redraw the "Your order" panel whenever:
  //   - the cart changes,
  //   - the shopper clicked Checkout in the cart panel,
  //   - the checkout VIEW has just been opened (via the nav or back button).
  // Passing the function name (without parentheses) means "call it when the
  // event happens". Writing renderCheckoutSummary() would call it immediately.
  document.addEventListener("cart-updated", renderCheckoutSummary);
  document.addEventListener("checkout-requested", renderCheckoutSummary);
  document.addEventListener("view-changed", (event) => {
    // event.detail.view is the NAME of the view that just opened.
    if (event.detail && event.detail.view === "checkout") {
      setFormMessage("", "");   // wipe leftover messages from last time
      renderCheckoutSummary();
    }
  });

  // Expose a small public helper so other files (e.g. main.js) COULD ask for a
  // redraw. Currently unused, but it shows how an IIFE exports on purpose.
  window.CheckoutModule = {
    renderSummary: renderCheckoutSummary
  };

  // First draw on page load, so the panel isn't blank/wrong initially.
  renderCheckoutSummary();
})();
