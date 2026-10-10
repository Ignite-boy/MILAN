/* Milan login/register page logic */
"use strict";

/* ---------------------------------------------------------
   Basic helpers
--------------------------------------------------------- */

const API_BASE = "/api";

function getToken() {
    try {
        return String(
            localStorage.getItem("milan_token") || ""
        ).trim();
    } catch (_) {
        return "";
    }
}

function setToken(token) {
    localStorage.setItem(
        "milan_token",
        token
    );

    localStorage.removeItem(
        "milanBootCache"
    );
}

function clearToken() {
    localStorage.removeItem(
        "milan_token"
    );
}

function showMessage(
    msg,
    isError = true
) {
    const msgDiv =
        document.getElementById("authMsg");

    if (!msgDiv) return;

    msgDiv.innerText = msg;
    msgDiv.style.color =
        isError
            ? "#e5484d"
            : "#10b981";

    setTimeout(() => {
        if (msgDiv.innerText === msg) {
            msgDiv.innerText = "";
        }
    }, 6000);
}

/* Already logged in */
(() => {
    const token = getToken();

    if (token) {
        window.location.replace("/app");
    }
})();

/* ---------------------------------------------------------
   Existing password UI
--------------------------------------------------------- */

window.togglePasswordVisibility =
    function () {
        const pwd =
            document.getElementById(
                "loginPass"
            );

        if (!pwd) return;

        pwd.type =
            pwd.type === "password"
                ? "text"
                : "password";
    };

const tabs =
    document.querySelectorAll(".tab");

const loginBox =
    document.getElementById("loginBox");

const registerBox =
    document.getElementById(
        "registerBox"
    );

const switchLink =
    document.getElementById(
        "switchToRegister"
    );

function setActiveTab(mode) {
    tabs.forEach((tab) => {
        tab.dataset.auth === mode
            ? tab.classList.add("active")
            : tab.classList.remove("active");
    });

    if (
        mode === "login"
    ) {
        loginBox?.classList.remove(
            "hidden"
        );

        registerBox?.classList.add(
            "hidden"
        );
    } else {
        loginBox?.classList.add(
            "hidden"
        );

        registerBox?.classList.remove(
            "hidden"
        );
    }

    const msg =
        document.getElementById(
            "authMsg"
        );

    if (msg) msg.innerText = "";
}

tabs.forEach((tab) => {
    tab.addEventListener(
        "click",
        () => setActiveTab(
            tab.dataset.auth
        )
    );
});

switchLink?.addEventListener(
    "click",
    (event) => {
        event.preventDefault();
        setActiveTab("register");
    }
);

/* ---------------------------------------------------------
   API helpers
--------------------------------------------------------- */

async function registerUser(
    name,
    email,
    password
) {
    const response =
        await fetch(
            "/api/auth/register",
            {
                method: "POST",
                headers: {
                    "Content-Type":
                        "application/json"
                },
                body: JSON.stringify({
                    name,
                    email,
                    password
                })
            }
        );

    const data =
        await response
            .json()
            .catch(() => ({}));

    if (!response.ok) {
        throw new Error(
            data.error ||
            "Registration failed"
        );
    }

    return data;
}

async function loginUser(
    email,
    password
) {
    const response =
        await fetch(
            "/api/auth/login",
            {
                method: "POST",
                headers: {
                    "Content-Type":
                        "application/json"
                },
                body: JSON.stringify({
                    email,
                    password
                })
            }
        );

    const data =
        await response
            .json()
            .catch(() => ({}));

    if (!response.ok) {
        throw new Error(
            data.error ||
            "Login failed"
        );
    }

    return data;
}

async function authenticatedJson(
    path,
    options = {}
) {
    const token =
        getToken();

    const response =
        await fetch(
            path,
            {
                cache: "no-store",
                ...options,
                headers: {
                    "Accept":
                        "application/json",
                    ...(options.headers || {}),
                    "Authorization":
                        "Bearer " + token
                }
            }
        );

    const data =
        await response
            .json()
            .catch(() => ({}));

    if (!response.ok) {
        throw new Error(
            data.error ||
            data.detail ||
            `Request failed (${response.status})`
        );
    }

    return data;
}

/* ---------------------------------------------------------
   Self-hosted SimpleWebAuthn browser library
--------------------------------------------------------- */

let simpleWebAuthnPromise = null;

function loadSimpleWebAuthnBrowser() {
    if (
        window.SimpleWebAuthnBrowser
    ) {
        return Promise.resolve(
            window.SimpleWebAuthnBrowser
        );
    }

    if (simpleWebAuthnPromise) {
        return simpleWebAuthnPromise;
    }

    simpleWebAuthnPromise =
        new Promise(
            (resolve, reject) => {
                const existing =
                    document.querySelector(
                        'script[data-milan-webauthn="1"]'
                    );

                if (existing) {
                    existing.addEventListener(
                        "load",
                        () => resolve(
                            window.SimpleWebAuthnBrowser
                        ),
                        { once: true }
                    );

                    existing.addEventListener(
                        "error",
                        () => reject(
                            new Error(
                                "ID3 security module could not load"
                            )
                        ),
                        { once: true }
                    );

                    return;
                }

                const script =
                    document.createElement(
                        "script"
                    );

                script.src =
                    "/assets/simplewebauthn-browser.min.js";

                script.async = true;
                script.dataset.milanWebauthn =
                    "1";

                script.onload = () => {
                    if (
                        !window.SimpleWebAuthnBrowser
                    ) {
                        reject(
                            new Error(
                                "ID3 security module unavailable"
                            )
                        );
                        return;
                    }

                    resolve(
                        window.SimpleWebAuthnBrowser
                    );
                };

                script.onerror = () => {
                    reject(
                        new Error(
                            "Could not load ID3 security module"
                        )
                    );
                };

                document.head.appendChild(
                    script
                );
            }
        );

    return simpleWebAuthnPromise;
}

/* ---------------------------------------------------------
   ID3 registration
--------------------------------------------------------- */

async function registerID3() {
    const didBtn =
        document.getElementById(
            "didLoginBtn"
        );

    if (!getToken()) {
        showMessage(
            "Sign in once with your password to enable ID3 on this device.",
            true
        );
        return;
    }

    try {
        didBtn.disabled = true;
        didBtn.innerHTML =
            '<span class="did-badge">did</span> Enabling ID3...';

        showMessage(
            "Create your secure ID3 passkey on this device...",
            false
        );

        const {
            startRegistration,
            browserSupportsWebAuthn
        } =
            await loadSimpleWebAuthnBrowser();

        if (
            browserSupportsWebAuthn &&
            !browserSupportsWebAuthn()
        ) {
            throw new Error(
                "This browser does not support secure ID3/passkey login."
            );
        }

        const options =
            await authenticatedJson(
                "/api/did/passkey/register/options"
            );

        const registrationResponse =
            await startRegistration({
                optionsJSON: options
            });

        const verification =
            await authenticatedJson(
                "/api/did/passkey/register/verify",
                {
                    method: "POST",
                    headers: {
                        "Content-Type":
                            "application/json"
                    },
                    body:
                        JSON.stringify(
                            registrationResponse
                        )
                }
            );

        if (!verification.verified) {
            throw new Error(
                "ID3 registration was not verified."
            );
        }

        didBtn.innerHTML =
            '<span class="did-badge">did</span> Sign with ID3';

        showMessage(
            "✅ ID3 enabled. You can now sign in with one click.",
            false
        );

        setTimeout(() => {
            window.location.replace(
                "/app?login=" +
                Date.now()
            );
        }, 900);

    } catch (error) {
        console.error(
            "[MILAN ID3] registration failed:",
            error
        );

        didBtn.disabled = false;

        didBtn.innerHTML =
            '<span class="did-badge">did</span> Sign with ID3';

        if (
            error?.name ===
            "NotAllowedError"
        ) {
            showMessage(
                "ID3 setup was cancelled.",
                true
            );
        } else {
            showMessage(
                error.message ||
                "Could not enable ID3.",
                true
            );
        }
    }
}

/* ---------------------------------------------------------
   ID3 single-click login
--------------------------------------------------------- */

async function loginWithID3() {
    const didBtn =
        document.getElementById(
            "didLoginBtn"
        );

    try {
        didBtn.disabled = true;

        didBtn.innerHTML =
            '<span class="did-badge">did</span> Verifying...';

        showMessage(
            "Waiting for your secure ID3 credential...",
            false
        );

        const {
            startAuthentication,
            browserSupportsWebAuthn
        } =
            await loadSimpleWebAuthnBrowser();

        if (
            browserSupportsWebAuthn &&
            !browserSupportsWebAuthn()
        ) {
            throw new Error(
                "This browser does not support secure ID3/passkey login."
            );
        }

        const options =
            await fetch(
                "/api/did/passkey/login/options",
                {
                    cache: "no-store",
                    headers: {
                        "Accept":
                            "application/json"
                    }
                }
            )
                .then(async (response) => {
                    const data =
                        await response
                            .json()
                            .catch(() => ({}));

                    if (!response.ok) {
                        const error =
                            new Error(
                                data.error ||
                                "ID3 login unavailable"
                            );

                        error.status =
                            response.status;

                        throw error;
                    }

                    return data;
                });

        const authenticationResponse =
            await startAuthentication({
                optionsJSON: options
            });

        const result =
            await fetch(
                "/api/did/passkey/login/verify",
                {
                    method: "POST",
                    headers: {
                        "Content-Type":
                            "application/json",
                        "Accept":
                            "application/json"
                    },
                    body:
                        JSON.stringify(
                            authenticationResponse
                        )
                }
            )
                .then(async (response) => {
                    const data =
                        await response
                            .json()
                            .catch(() => ({}));

                    if (!response.ok) {
                        throw new Error(
                            data.error ||
                            "ID3 verification failed"
                        );
                    }

                    return data;
                });

        if (!result.token) {
            throw new Error(
                "No MILAN token received."
            );
        }

        setToken(result.token);

        try {
            const profile =
                await fetch(
                    "/api/profile",
                    {
                        headers: {
                            Authorization:
                                "Bearer " +
                                result.token
                        },
                        cache: "no-store"
                    }
                ).then(
                    (response) =>
                        response.json()
                );

            if (
                profile?.avatar
            ) {
                localStorage.setItem(
                    "milanAvatar",
                    profile.avatar
                );
            }
        } catch (error) {
            console.warn(
                "[MILAN ID3] profile hydrate failed:",
                error.message
            );
        }

        showMessage(
            "✅ ID3 login successful. Opening MILAN...",
            false
        );

        window.location.replace(
            "/app?login=" +
            Date.now()
        );

    } catch (error) {
        console.error(
            "[MILAN ID3] login failed:",
            error
        );

        didBtn.disabled = false;

        didBtn.innerHTML =
            '<span class="did-badge">did</span> Sign with ID3';

        if (
            error?.name ===
            "NotAllowedError"
        ) {
            showMessage(
                "ID3 authentication was cancelled.",
                true
            );
            return;
        }

        if (
            error?.status === 409
        ) {
            showMessage(
                "Sign in once with your password, then enable ID3 on this device.",
                true
            );
            return;
        }

        showMessage(
            error.message ||
            "ID3 login failed.",
            true
        );
    }
}

/* ---------------------------------------------------------
   DID button decides:
   no token  -> login
   token     -> register
--------------------------------------------------------- */

function bindID3Button() {
    const didBtn =
        document.getElementById(
            "didLoginBtn"
        );

    if (!didBtn) return;

    didBtn.addEventListener(
        "click",
        async () => {
            if (getToken()) {
                await registerID3();
            } else {
                await loginWithID3();
            }
        }
    );
}

/* ---------------------------------------------------------
   Password registration
--------------------------------------------------------- */

const registerBtn =
    document.getElementById(
        "registerBtn"
    );

if (registerBtn) {
    registerBtn.addEventListener(
        "click",
        async () => {
            const name =
                document
                    .getElementById(
                        "regName"
                    )
                    ?.value
                    ?.trim() || "";

            const email =
                document
                    .getElementById(
                        "regEmail"
                    )
                    ?.value
                    ?.trim() || "";

            const password =
                document.getElementById(
                    "regPass"
                )?.value || "";

            if (
                !name ||
                !email ||
                !password
            ) {
                showMessage(
                    "Please fill all fields.",
                    true
                );
                return;
            }

            if (
                password.length < 8
            ) {
                showMessage(
                    "Password must be at least 8 characters.",
                    true
                );
                return;
            }

            registerBtn.disabled =
                true;

            registerBtn.textContent =
                "Creating account...";

            try {
                await registerUser(
                    name,
                    email,
                    password
                );

                document
                    .querySelector(
                        '[data-auth="login"]'
                    )
                    ?.click();

                const emailInput =
                    document.getElementById(
                        "loginEmail"
                    );

                const passInput =
                    document.getElementById(
                        "loginPass"
                    );

                if (emailInput) {
                    emailInput.value =
                        email;
                }

                if (passInput) {
                    passInput.value = "";
                }

                showMessage(
                    "✅ Registration successful. Please login.",
                    false
                );

            } catch (error) {
                showMessage(
                    error.message ||
                    "Registration failed.",
                    true
                );
            } finally {
                registerBtn.disabled =
                    false;

                registerBtn.textContent =
                    "Create my MILAN space";
            }
        }
    );
}

/* ---------------------------------------------------------
   Password login
--------------------------------------------------------- */

const loginBtn =
    document.getElementById(
        "loginBtn"
    );

if (loginBtn) {
    loginBtn.addEventListener(
        "click",
        async () => {
            const email =
                document
                    .getElementById(
                        "loginEmail"
                    )
                    ?.value
                    ?.trim()
                    .toLowerCase() || "";

            const password =
                document.getElementById(
                    "loginPass"
                )?.value || "";

            if (
                !email ||
                !password
            ) {
                showMessage(
                    "Please enter email and password.",
                    true
                );
                return;
            }

            loginBtn.disabled =
                true;

            loginBtn.textContent =
                "Logging in...";

            try {
                const loginData =
                    await loginUser(
                        email,
                        password
                    );

                if (!loginData.token) {
                    throw new Error(
                        "No token received."
                    );
                }

                setToken(
                    loginData.token
                );

                try {
                    const profile =
                        await fetch(
                            "/api/profile",
                            {
                                headers: {
                                    Authorization:
                                        "Bearer " +
                                        loginData.token
                                },
                                cache:
                                    "no-store"
                            }
                        ).then(
                            response =>
                                response.json()
                        );

                    if (
                        profile?.avatar
                    ) {
                        localStorage.setItem(
                            "milanAvatar",
                            profile.avatar
                        );
                    }
                } catch (_) {}

                const remembered =
                    document.getElementById(
                        "rememberMeCheckbox"
                    );

                if (
                    remembered?.checked
                ) {
                    localStorage.setItem(
                        "rememberedEmail",
                        email
                    );
                } else {
                    localStorage.removeItem(
                        "rememberedEmail"
                    );
                }

                /*
                 * First successful password login:
                 * check whether this device already has ID3.
                 */
                let id3Registered =
                    false;

                try {
                    const status =
                        await authenticatedJson(
                            "/api/did/passkey/status"
                        );

                    id3Registered =
                        Boolean(
                            status.registered
                        );
                } catch (_) {}

                if (
                    !id3Registered
                ) {
                    loginBtn.disabled =
                        false;

                    loginBtn.textContent =
                        "Login →";

                    const didBtn =
                        document.getElementById(
                            "didLoginBtn"
                        );

                    if (didBtn) {
                        didBtn.innerHTML =
                            '<span class="did-badge">did</span> Enable ID3 Login';
                    }

                    showMessage(
                        "✅ Login successful. Enable ID3 once on this device for one-click login.",
                        false
                    );

                    return;
                }

                showMessage(
                    "✅ Login successful! Redirecting...",
                    false
                );

                window.location.replace(
                    "/app?login=" +
                    Date.now()
                );

            } catch (error) {
                clearToken();

                showMessage(
                    error.message ||
                    "Login failed.",
                    true
                );

            } finally {
                if (
                    !loginBtn.disabled
                ) {
                    loginBtn.textContent =
                        "Login →";
                }
            }
        }
    );
}

/* ---------------------------------------------------------
   Existing visual enhancements
--------------------------------------------------------- */

(function () {
    const hero =
        document.querySelector(
            ".authHero"
        );

    if (hero) {
        hero.classList.add(
            "milan-login-aurora"
        );
    }

    const regBtn =
        document.querySelector(
            "#registerBtn"
        );

    if (regBtn) {
        const didGenEl =
            document.createElement(
                "div"
            );

        didGenEl.id =
            "milan-did-gen";

        regBtn.parentNode.insertBefore(
            didGenEl,
            regBtn
        );
    }

    const loginVisualBtn =
        document.querySelector(
            "#loginBtn"
        );

    if (loginVisualBtn) {
        const prog =
            document.createElement(
                "div"
            );

        prog.id =
            "milan-login-progress";

        loginVisualBtn.parentNode.insertBefore(
            prog,
            loginVisualBtn.nextSibling
        );

        loginVisualBtn.addEventListener(
            "click",
            () => {
                prog.style.display =
                    "block";

                prog.style.width =
                    "0%";

                setTimeout(
                    () =>
                        prog.style.width =
                            "60%",
                    100
                );

                setTimeout(
                    () =>
                        prog.style.width =
                            "85%",
                    400
                );

                setTimeout(
                    () =>
                        prog.style.width =
                            "100%",
                    1200
                );

                setTimeout(
                    () => {
                        prog.style.display =
                            "none";

                        prog.style.width =
                            "0%";
                    },
                    2000
                );
            }
        );
    }
})();

/* ---------------------------------------------------------
   Theme
--------------------------------------------------------- */

(function () {
    try {
        const theme =
            localStorage.getItem(
                "milan_theme"
            ) || "dark";

        const accent =
            localStorage.getItem(
                "milan_accent"
            );

        if (
            theme === "dark" ||
            theme === "amoled"
        ) {
            document.body.classList.add(
                "dark"
            );
        }

        if (theme === "amoled") {
            document.body.style.cssText +=
                ";--bg:#000;--card:#0a0a0a;";
        }

        const accentMap = {
            ocean: "#2563eb",
            emerald: "#10b981",
            crimson: "#ef4444",
            violet: "#7c3aed"
        };

        if (
            accent &&
            accentMap[accent]
        ) {
            document.documentElement
                .style
                .setProperty(
                    "--brand",
                    accentMap[accent]
                );
        }
    } catch (_) {}
})();

/* ---------------------------------------------------------
   Command shortcut
--------------------------------------------------------- */

document.addEventListener(
    "keydown",
    (event) => {
        if (
            (event.ctrlKey ||
                event.metaKey) &&
            event.key === "k"
        ) {
            event.preventDefault();

            showMessage(
                "Command Palette is available in the main app after login.",
                false
            );
        }
    }
);

/* ---------------------------------------------------------
   Init
--------------------------------------------------------- */

if (
    document.readyState ===
    "loading"
) {
    document.addEventListener(
        "DOMContentLoaded",
        bindID3Button,
        { once: true }
    );
} else {
    bindID3Button();
}

console.log(
    "[MILAN] ID3 / Passkey authentication ready."
);
