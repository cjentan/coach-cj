import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role?: string;
      locale?: string;
    } & DefaultSession["user"];
  }
}
