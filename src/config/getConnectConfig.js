export function getConnectConfig() {
    const params = new URLSearchParams(window.location.search);

    const instance = params.get("instance");
    const region = params.get("region");

    if (!instance) {
        throw new Error("Missing required 'instance' URL parameter");
    }

    if (!region) {
        throw new Error("Missing required 'region' URL parameter");
    }

    if (!/^[a-z0-9-]+$/.test(instance)) {
        throw new Error("Invalid Amazon Connect instance alias");
    }

    if (!/^[a-z]{2}-[a-z]+-\d$/.test(region)) {
        throw new Error("Invalid AWS region");
    }

    const connectUrl = `https://${instance}.my.connect.aws`;

    return {
        env: instance,
        connectUrl,
        region
    };
}