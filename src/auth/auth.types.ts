/** Usuário extraído do JWT e injetado no request pelo AuthGuard. */
export interface AuthUser {
  id: string;
  email: string;
}

/** Resposta retornada pelos endpoints de register e login. */
export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  user: {
    id: string;
    email: string;
    name: string;
  };
}
