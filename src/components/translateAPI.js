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
        const { body } = await post({
            apiName,
            path,
            options: myInit,
        });

        // ✅ FIX 1: Normalize body safely
        let data;

        if (body instanceof ReadableStream) {
            const text = await new Response(body).text();
            data = JSON.parse(text);
        } else if (typeof body?.json === "function") {
            data = await body.json();
        } else {
            data = body;
        }

        console.log("Parsed Response:", data);

        // ✅ FIX 2: return ONLY translated text (not full object)
        return data?.TranslatedText ?? null;

    } catch (error) {
        console.error("ProcessChatTextAPI failed:", error);
        return null;
    }
}

export default ProcessChatTextAPI;
