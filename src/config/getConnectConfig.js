export function getConnectConfig() {
    const path = window.location.pathname.toLowerCase();

    // Normalize route (handles /uat, /uat/, etc.)
    const route = path.split("/").filter(Boolean)[0];

    const configs = {
        uat: {
            env: "UAT",
            connectUrl: "https://uatrdf-genesysdr.my.connect.aws",
            region: "us-east-1"
        },
        prod: {
            env: "PROD",
            connectUrl: "https://prodrdf-genesysdr.my.connect.aws",
            region: "us-east-1"
        }
    };

    // Default fallback (important for localhost or root "/")
    return configs[route] || configs.prod;
}