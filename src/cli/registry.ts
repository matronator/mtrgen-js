import path from "node:path";

type FetchImplementation = typeof fetch;

export interface RegistryClientOptions {
    apiUrl?: string;
    fetchImplementation?: FetchImplementation;
}

export interface RegistryLoginResponse {
    status?: string;
    token?: string;
    message?: string;
}

export interface RemoteTemplate {
    fileName: string;
    contents: string;
    contentType: string;
}

export interface PublishTemplateInput {
    username: string;
    token: string;
    fileName: string;
    templateName: string;
    contents: string;
}

export interface RegistryPublishResponse {
    status?: string;
    message?: string;
}

const DEFAULT_API_URL = "https://mtrgen.matronator.cz/api";

export class RegistryClient {
    readonly apiUrl: string;
    readonly fetchImplementation: FetchImplementation;

    constructor(options: RegistryClientOptions = {}) {
        this.apiUrl = (options.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, "");
        this.fetchImplementation = options.fetchImplementation ?? fetch;
    }

    async signup(username: string, password: string): Promise<void> {
        const response = await this.fetchImplementation(`${this.apiUrl}/signup`, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                username: username.toLowerCase(),
                password,
            }),
        });

        if (!response.ok) {
            throw new Error(await this.#readErrorMessage(response, "Unable to create user."));
        }
    }

    async login(username: string, password: string, duration = 24): Promise<RegistryLoginResponse> {
        const response = await this.fetchImplementation(`${this.apiUrl}/login`, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                username: username.toLowerCase(),
                password,
                duration: String(duration),
            }),
        });

        const body = await this.#readJson<RegistryLoginResponse>(response);
        if (!response.ok) {
            return body;
        }

        return body;
    }

    async getTemplate(identifier: string): Promise<RemoteTemplate> {
        const { vendor, name } = parseTemplateIdentifier(identifier);
        const response = await this.fetchImplementation(`${this.apiUrl}/templates/${vendor}/${name}/get`, {
            headers: {
                "X-Requested-By": "cli",
            },
        });

        if (!response.ok) {
            throw new Error(await this.#readErrorMessage(response, `Couldn't find template "${identifier}".`));
        }

        const fileNameHeader = response.headers.get("X-Template-Filename");
        const contents = await response.text();

        return {
            fileName: fileNameHeader ? path.basename(fileNameHeader) : `${name}.mtr`,
            contents,
            contentType: response.headers.get("Content-Type") ?? "text/plain",
        };
    }

    async publishTemplate(input: PublishTemplateInput): Promise<RegistryPublishResponse> {
        const response = await this.fetchImplementation(`${this.apiUrl}/templates`, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                Authorization: `Bearer ${input.token}`,
            },
            body: new URLSearchParams({
                username: input.username,
                filename: input.fileName,
                name: input.templateName.toLowerCase(),
                contents: input.contents,
            }),
        });

        return this.#readJson<RegistryPublishResponse>(response);
    }

    async #readJson<T>(response: Response): Promise<T> {
        const contentType = response.headers.get("Content-Type") ?? "";
        if (!contentType.includes("application/json")) {
            return { message: await response.text() } as T;
        }

        return await response.json() as T;
    }

    async #readErrorMessage(response: Response, fallback: string): Promise<string> {
        const parsed = await this.#readJson<{ message?: string; error?: string }>(response);
        return parsed.message ?? parsed.error ?? fallback;
    }
}

export function parseTemplateIdentifier(identifier: string): { vendor: string; name: string } {
    const trimmed = identifier.trim();
    const separatorIndex = trimmed.indexOf("/");
    const vendor = separatorIndex === -1 ? "" : trimmed.slice(0, separatorIndex).trim();
    const name = separatorIndex === -1 ? "" : trimmed.slice(separatorIndex + 1).trim();

    if (!vendor || !name) {
        throw new Error(`Invalid template identifier "${identifier}". Use vendor/name.`);
    }

    return { vendor, name };
}
