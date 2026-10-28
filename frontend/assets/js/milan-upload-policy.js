(function (root) {
    "use strict";

    function getVideoUploadConcurrency(totalChunks, options = {}) {
        const count = Math.floor(Number(totalChunks));
        if (!Number.isFinite(count) || count <= 1) return 1;

        const connection = options.connection || {};
        const type = String(connection.effectiveType || "").toLowerCase();
        const downlink = Number(connection.downlink);
        const rtt = Number(connection.rtt);
        let recommended = 3;

        if (connection.saveData || /^(slow-2g|2g)$/.test(type)) {
            recommended = 1;
        } else if (
            type === "3g" ||
            (Number.isFinite(downlink) && downlink > 0 && downlink <= 1.5) ||
            (Number.isFinite(rtt) && rtt >= 500)
        ) {
            recommended = 2;
        }

        const memory = Number(options.deviceMemory);
        const cores = Number(options.hardwareConcurrency);
        const lowMemory = Number.isFinite(memory) && memory > 0 && memory <= 2;
        const lowCores = Number.isFinite(cores) && cores > 0 && cores <= 2;
        if (lowMemory || lowCores) recommended = Math.min(recommended, 2);

        const rawOverride = options.override;
        const override = Number(rawOverride);
        const hasOverride =
            rawOverride !== undefined &&
            rawOverride !== null &&
            rawOverride !== "" &&
            Number.isFinite(override) &&
            override >= 1;

        if (hasOverride) {
            recommended = Math.max(1, Math.min(3, Math.floor(override)));
        }

        return Math.max(1, Math.min(count, recommended));
    }

    const api = Object.freeze({ getVideoUploadConcurrency });
    if (typeof module === "object" && module.exports) module.exports = api;
    if (root) root.MilanUploadPolicy = api;
})(typeof window !== "undefined" ? window : globalThis);
