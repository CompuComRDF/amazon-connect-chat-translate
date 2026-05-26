import { post } from '@aws-amplify/api';

async function ProcessChatTextAPI(content, sourceLang, targetLang) {
    const apiName = 'amazonTranslateAPI';
    const path = '/translate';

    const myInit = {
        body: {
            content,
            sourceLang,
            targetLang
        }
    };

    console.log("ProcessChatTextAPI:", { content, sourceLang, targetLang });

    try {
        const response = await post({
            apiName,
            path,
            options: myInit,
        });

        console.log("Raw response:", response);

        // ✅ IMPORTANT FIX: Amplify v6 response handling
        const data = await response.response;

        // If body is already parsed JSON
        if (data && typeof data.json === "function") {
            const json = await data.json();
            console.log("Parsed Response:", json);
            return json;
        }

        // fallback safety
        if (data?.body) {
            const text = await data.body.text?.();
            const json = JSON.parse(text);
            console.log("Parsed Response (text fallback):", json);
            return json;
        }

        console.error("Unexpected response format:", data);
        return null;

    } catch (error) {
        console.error("ProcessChatTextAPI ERROR:", error);
        return null;
    }
}

export default ProcessChatTextAPI;