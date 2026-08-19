import { IUser } from "../shared/user/model/user.model";

declare global {
  namespace Express {
    interface Request {
      user?: IUser;
      firebaseUid?: string;
    }
  }
}

export {};
