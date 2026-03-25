import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { TemplateStore } from "./store";

interface ProfileData {
    username: string;
    token: string;
}

export interface CliProfileOptions {
    homeDir?: string;
}

export class CliProfile {
    readonly profilePath: string;

    constructor(options: CliProfileOptions = {}) {
        const store = new TemplateStore({ homeDir: options.homeDir });
        this.profilePath = path.join(store.homeDir, "profile.json");

        if (!existsSync(this.profilePath)) {
            this.clear();
        }
    }

    load(): ProfileData {
        if (!existsSync(this.profilePath)) {
            this.clear();
        }

        const parsed = JSON.parse(readFileSync(this.profilePath, "utf8")) as Partial<ProfileData> | null;

        return {
            username: typeof parsed?.username === "string" ? parsed.username : "",
            token: typeof parsed?.token === "string" ? parsed.token : "",
        };
    }

    save(username: string, token: string): void {
        this.#write({
            username,
            token,
        });
    }

    clear(): void {
        this.#write({
            username: "",
            token: "",
        });
    }

    isLoggedIn(): boolean {
        const profile = this.load();
        return profile.username.length > 0 && profile.token.length > 0;
    }

    #write(data: ProfileData): void {
        writeFileSync(this.profilePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    }
}
