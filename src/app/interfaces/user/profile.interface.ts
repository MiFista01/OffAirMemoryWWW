import { User } from './user.interface';

export interface Profile {
  id: number;
  userId: number;
  nickname: string;
  online: boolean;
  avatar: string | null;
  friends?: Friend[];
  user?: User;
}

export interface Friend {
  profileId: number;
  friendId: number;
  status: 'pending' | 'accepted' | 'blocked';
  createdAt: string;
  updatedAt: string;
}

export interface PersonalInfo {
  firstName: string;
  lastName: string;
  birthDate: string;
  gender: string;
  location: string;
  additionalInfo: string;
}
