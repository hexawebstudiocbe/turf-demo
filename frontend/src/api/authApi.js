import axiosClient from './axiosClient';

export const authApi = {
  login: (credentials) => axiosClient.post('/auth/login', credentials),
};
