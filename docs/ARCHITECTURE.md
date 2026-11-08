# Focus Spoofer Technical Specification

## 1. Overview

The modern web platform provides mechanisms for origins to monitor user engagement and viewport visibility. This is primarily exposed through two distinct but related API surfaces:

*   **Visibility API:** Exposed via `document.visibilityState` (returning `"visible"`, `"hidden"`, or `"prerender"`) and the deprecated numeric boolean `document.hidden`.
*   **Focus API:** Exposed via the `document.hasFocus()` method, returning a boolean indicating if the document or any element within it currently has keyboard focus.
*   **Window Events:** The `Window` interface dispatches `blur` and `focus` events when the window loses or gains focus, respectively.

Modern web applications monitor these signals to optimize resource consumption, pause rendering pipelines, suspend websocket polling mechanisms, or implement anti-automation and anti-idle detection. Real-world implications of these mechanisms include timer throttling (e.g., `setTimeout` clamped to >= 1000ms in background tabs), background execution suspension, and state desynchronization in real-time applications when the tab is backgrounded.

Focus Spoofer normalizes these signals, ensuring the `Document` and `Window` objects permanently report an active, focused, and visible state to the executing page context.

## 2. Threat / Detection Model

Origins detect loss of focus through a combination of event listeners and property polling:

*   **Event Listeners:** Sites attach listeners for `visibilitychange` on the `Document`, and `blur`/`focus` on the `Window`. The `pagehide` and `freeze` events from the Page Lifecycle API are also utilized.
*   **Background Tab Throttling:** Advanced scripts infer background state by measuring tick drift in `requestAnimationFrame` or `setTimeout` loops. If a 16ms interval drifts to 1000ms, the site infers visibility loss.
*   **Lifecycle API Interactions:** The `Document` transition to `"hidden"` typically precedes the `freeze` lifecycle state. Sites monitor the `resume` event to force state re-synchronization.
*   **Fingerprinting Vectors:** The correlation (or lack thereof) between `visibilityState`, `hasFocus()`, and user-initiated interaction events (e.g., mouse movement without focus) can be used as an anomaly detection vector. Mismatched property states or missing expected event sequences reveal the presence of spoofing mechanisms.

## 3. Architecture

Focus Spoofer is implemented as a Manifest V3 (MV3) Chrome extension.

The core spoofing logic requires execution within the main page context rather than the extension's isolated world. This is achieved via a content script injected at `document_start`. The content script executes via the `MAIN` world configuration in MV3 (or injects a standard `<script>` tag into the DOM as a fallback) to execute immediately before any site-authored scripts.

Overriding prototype properties directly on instance objects (e.g., `document.visibilityState = 'visible'`) fails because these properties are typically defined as getters on `Document.prototype`. Attempting instance-level assignment throws errors in strict mode or is bypassed if the site reads the prototype getter directly via `Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState').get.call(document)`.

To ensure robust spoofing, the descriptors on `Document.prototype` must be redefined. To survive site reassignments, the redefined properties are configured with `configurable: false` where applicable, or setter interception/redefinition is implemented to drop overrides.

### Overriding `document.visibilityState`
```javascript
Object.defineProperty(Document.prototype, 'visibilityState', {
    get: function() { return 'visible'; },
    configurable: true,
    enumerable: true
});
```

### Overriding `document.hidden`
```javascript
Object.defineProperty(Document.prototype, 'hidden', {
    get: function() { return false; },
    configurable: true,
    enumerable: true
});
```

### Overriding `document.hasFocus()`
```javascript
Document.prototype.hasFocus = function() {
    return true;
};
```

### Intercepting `addEventListener` and Neutralizing Events
```javascript
const originalAddEventListener = EventTarget.prototype.addEventListener;
EventTarget.prototype.addEventListener = function(type, listener, options) {
    if (type === 'visibilitychange' || type === 'blur' || type === 'focus') {
        const wrappedListener = function(event) {
            if (type === 'blur' || type === 'visibilitychange') {
                event.stopImmediatePropagation();
                return;
            }
            if (type === 'focus' && document.hasFocus()) {
                // Allow focus event to propagate normally
            }
        };
        return originalAddEventListener.call(this, type, wrappedListener, options);
    }
    return originalAddEventListener.call(this, type, listener, options);
};
```

## 4. Implementation Details

The implementation relies heavily on `Object.defineProperty` for getter hijacking. By manipulating the property descriptors on standard objects before the target application loads, we mutate the execution environment.

Event suppression is achieved by wrapping the `EventTarget.prototype.addEventListener` method. When an origin attempts to bind to `visibilitychange` or `blur`, the callback is either stored but never invoked, or a proxy wrapper prevents the propagation of specific event instances via `event.stopImmediatePropagation()`.

**Edge Cases:**
*   **Iframes:** The injection script must target `all_frames: true` in the manifest to ensure independent contexts within `<iframe>` elements are also patched.
*   **Shadow DOM:** While encapsulated, Shadow DOM instances inherit from the patched `Document.prototype` and `EventTarget.prototype`, meaning overrides natively propagate.
*   **CSP Restrictions:** Inline script injection (`<script>` tag insertion) might violate strict Content Security Policies (`script-src`). The MV3 world specification (`world: "MAIN"`) provides a bypass for strict CSPs by allowing native execution in the page context without explicit DOM tag injection.
*   **Service Workers:** Service workers operate in a different context (`ServiceWorkerGlobalScope`) lacking the DOM APIs. They do not have access to `document.visibilityState` or `hasFocus()`, rendering spoofing irrelevant but also impossible in that context.
*   **Chrome Throttling:** While APIs return spoofed values, Chrome's underlying V8 thread scheduling still applies. Background CPU throttling cannot be bypassed from userland JavaScript.

## 5. Performance Considerations

*   **Execution Overhead:** The core patching script executes in <2ms on modern hardware during the critical path of `document_start`.
*   **Descriptor Patching Cost:** Redefining getters on prototypes introduces negligible memory overhead. V8's inline caching may be slightly impacted due to megamorphic property accesses, but the real-world latency difference is immeasurable.
*   **Event Interception Cost:** Wrapping `addEventListener` adds sub-millisecond overhead to every event listener binding on the page. In heavily reactive applications (e.g., React, Vue), this can accumulate. The wrapper logic must be strictly optimized to check the `type` string argument immediately.
*   **Microbenchmark Considerations:** Sites employing timing side-channels to verify visibility will still detect backgrounding. Attempting to spoof `performance.now()` or `Date.now()` introduces unacceptable desynchronization bugs and is outside the scope of focus validation.

## 6. Security & Ethics

**Intended Use Cases:**
*   Privacy research and limiting behavioral fingerprinting.
*   Automated testing environments (e.g., Puppeteer, Playwright) where browser contexts lose focus.
*   Researching anti-fraud and anti-bot mechanisms.

**Misuse:**
*   This extension is not designed to assist in evading terms of service agreements, bypassing mandatory educational content viewing metrics, or facilitating click-fraud operations.
*   Abusing focus spoofing for policy evasion carries the risk of account termination or IP blacklisting by the target origin platform.

## 7. Limitations

*   **CPU Throttling:** Cannot bypass Chrome's background CPU throttling (timers still clamp to >= 1000ms after 5 minutes in the background).
*   **OS Power States:** Cannot bypass OS-level sleep, hibernation, or application nap states (e.g., macOS App Nap).
*   **Cross-Origin Iframes:** Cannot override behavior in cross-origin iframes unless explicit host permissions are granted for those nested origins.
*   **Server-Side Validation:** Cannot bypass server-side activity validation requiring active heartbeat packets, valid cryptographic timing proofs, or CAPTCHA resolution.

## 8. Future Work

*   **Selective Spoofing:** Implementing rule-based execution per domain to reduce global state mutation.
*   **Toggle UI:** Developing a popup/action interface for real-time state manipulation.
*   **Granular API Interception:** Providing configurable overrides for specific APIs (e.g., spoofing `blur` but retaining `visibilityState`).
*   **MutationObserver Hardening:** Preventing sites from detecting the injected `<script>` tag via `MutationObserver` (when not using MV3 `MAIN` world contexts).
