import cloudinary from "../../../config/cloudinary";
import { AppError } from "../../../utils/AppError";
import { IUser, User } from "../model/user.model";

export interface CandidateProfileInput {
  headline: string;
  about: string;
  interests: string[];
  removeAvatar: boolean;
}

const uploadAvatar = (
  buffer: Buffer,
  userId: string,
): Promise<{ url: string; publicId: string }> =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "candidate-avatars",
        resource_type: "image",
        public_id: `${userId}-${Date.now()}`,
        overwrite: false,
      },
      (error, result) => {
        if (error || !result) {
          console.error("[candidate-profile] Failed to upload avatar:", error);
          reject(new AppError("Failed to upload profile photo", 502));
          return;
        }
        resolve({ url: result.secure_url, publicId: result.public_id });
      },
    );
    stream.end(buffer);
  });

const removeStoredAvatar = async (publicId: string | undefined) => {
  if (!publicId) return;
  try {
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: "image",
    });
    if (result.result !== "ok" && result.result !== "not found") {
      console.error(
        `[candidate-profile] Cloudinary did not remove avatar ${publicId}:`,
        result.result,
      );
    }
  } catch (error) {
    console.error(
      `[candidate-profile] Failed to remove old avatar ${publicId}:`,
      error,
    );
  }
};

export const updateCandidateProfile = async (
  userId: string,
  input: CandidateProfileInput,
  avatarFile?: Express.Multer.File,
): Promise<IUser> => {
  if (input.headline.length > 120) {
    throw new AppError("Headline must be 120 characters or fewer", 400);
  }
  if (input.about.length > 1000) {
    throw new AppError("About section must be 1000 characters or fewer", 400);
  }
  if (input.interests.length > 20) {
    throw new AppError("You can add up to 20 interests", 400);
  }
  if (
    input.interests.some(
      (interest) => interest.trim().length === 0 || interest.trim().length > 50,
    )
  ) {
    throw new AppError("Each interest must be between 1 and 50 characters", 400);
  }
  if (avatarFile && input.removeAvatar) {
    throw new AppError("Choose either a new profile photo or remove the current one", 400);
  }

  const user = await User.findById(userId).select("+avatarPublicId");
  if (!user) {
    throw new AppError("User profile not found", 404);
  }
  if (user.role !== "candidate") {
    throw new AppError("Candidate profile access required", 403);
  }

  const oldAvatarPublicId = user.avatarPublicId;
  let uploadedAvatar: { url: string; publicId: string } | undefined;
  if (avatarFile) {
    uploadedAvatar = await uploadAvatar(avatarFile.buffer, userId);
  }

  user.headline = input.headline.trim();
  user.about = input.about.trim();
  user.interests = [
    ...new Set(input.interests.map((interest) => interest.trim())),
  ];

  if (uploadedAvatar) {
    user.avatarUrl = uploadedAvatar.url;
    user.avatarPublicId = uploadedAvatar.publicId;
  } else if (input.removeAvatar) {
    user.avatarUrl = undefined;
    user.avatarPublicId = undefined;
  }

  try {
    await user.save();
  } catch (error) {
    if (uploadedAvatar) await removeStoredAvatar(uploadedAvatar.publicId);
    throw error;
  }

  if (uploadedAvatar || input.removeAvatar) {
    await removeStoredAvatar(oldAvatarPublicId);
  }

  return user;
};
