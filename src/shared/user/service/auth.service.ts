import jwt from "jsonwebtoken";
import { firebaseAuth } from "../../../config/firebase";
import { User, IUser, UserRole } from "../model/user.model";
import { AppError } from "../../../utils/AppError";

interface SignupInput {
  name: string;
  email: string;
  password: string;
  role: UserRole;
}

interface LoginInput {
  email: string;
  password: string;
}

const generateToken = (userId: string) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new AppError("JWT_SECRET is not defined in the environment", 500);
  }
  return jwt.sign({ id: userId }, secret, {
    expiresIn: "1d", // Token expires in 1 day
  });
};

export const signup = async (
  input: SignupInput
): Promise<{ token: string; user: IUser }> => {
  const { name, email, password, role } = input;

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    throw new AppError("Email already registered", 409);
  }

  // Password is hashed automatically by the pre-save hook on the User model.
  const user = await User.create({
    name,
    email,
    password,
    role,
    authProvider: "password",
  });

  const token = generateToken(user._id.toString());

  user.password = undefined;
  return { token, user };
};

export const login = async (
  input: LoginInput
): Promise<{ token: string; user: IUser }> => {
  const { email, password } = input;

  // Find the user and explicitly select the password field (it's select:false by default)
  const user = await User.findOne({ email: email.toLowerCase() }).select(
    "+password"
  );

  if (!user || !user.password) {
    // No user, or user signed up via Google and has no password to compare against
    throw new AppError("Invalid email or password", 401);
  }
  if (!user.isActive) {
    throw new AppError("Account is deactivated", 403);
  }

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    throw new AppError("Invalid email or password", 401);
  }

  const token = generateToken(user._id.toString());

  user.password = undefined;
  return { token, user };
};

export const googleLogin = async (
  idToken: string,
  role: UserRole = "candidate"
): Promise<{ token: string; user: IUser }> => {
  let decoded;
  try {
    decoded = await firebaseAuth.verifyIdToken(idToken);
  } catch (error) {
    throw new AppError("Invalid or expired Google ID token", 401);
  }

  if (!decoded.email) {
    throw new AppError("Google account has no email", 400);
  }

  const existing = await User.findOne({ email: decoded.email.toLowerCase() });

  if (existing) {
    if (existing.authProvider !== "google") {
      throw new AppError(
        "This email is already registered with a password. Please log in manually.",
        409
      );
    }
    if (!existing.isActive) {
      throw new AppError("Account is deactivated", 403);
    }
    // Existing Google user: no password involved, just issue our own session token.
    const token = generateToken(existing._id.toString());
    return { token, user: existing };
  }

  // New Google user: no password field is ever set, matching the schema's optional password.
  const newUser = await User.create({
    firebaseUid: decoded.uid,
    name: decoded.name || decoded.email.split("@")[0],
    email: decoded.email,
    role,
    authProvider: "google",
    avatarUrl: decoded.picture,
  });

  const token = generateToken(newUser._id.toString());
  return { token, user: newUser };
};

export const getProfile = async (userId: string): Promise<IUser> => {
  const user = await User.findById(userId);
  if (!user) {
    throw new AppError("User profile not found", 404);
  }
  return user;
};
