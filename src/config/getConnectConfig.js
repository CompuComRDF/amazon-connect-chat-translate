const SSO_LOGIN_URLS_BY_INSTANCE = {
    "uatrdf-genesysdr": "https://us-east-1.console.aws.amazon.com/connect/federate/b976f223-5ca9-4445-9a6f-d890d8dee0cd", 
    "prodrdf-genesysdr": "https://us-east-1.console.aws.amazon.com/connect/federate/894c5ab7-3400-4001-b3d9-797f65f10ecf" 
    };

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
        loginUrl: SSO_LOGIN_URLS_BY_INSTANCE[instance],
        region
    };
}