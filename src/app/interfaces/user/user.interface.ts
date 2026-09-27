import { Auth } from './auth.interface';
import { PersonalInfo, Profile } from './profile.interface';
import { Settings } from './settings.interface';

export interface User {
  id: number;
  createdAt: string;
  updatedAt: string;

  auth?: Auth;
  profile?: Profile;
  personalInfo?: PersonalInfo;
  settings?: Settings;
}
