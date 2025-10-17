import type { ValidatedAccessToken } from './token-validator';

export interface UserTokenProvider {
  getToken(validated: ValidatedAccessToken): Promise<string>;
}

class PassThroughUserTokenProvider implements UserTokenProvider {
  async getToken(validated: ValidatedAccessToken): Promise<string> {
    return validated.token;
  }
}

export const userTokenProvider: UserTokenProvider = new PassThroughUserTokenProvider();
