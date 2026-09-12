import { v2 as cloudinary } from "cloudinary";
import { getEnv } from "./env";

const { cloudinaryCloudName, cloudinaryApiKey, cloudinaryApiSecret } = getEnv();

cloudinary.config({
  cloud_name: cloudinaryCloudName,
  api_key: cloudinaryApiKey,
  api_secret: cloudinaryApiSecret,
});

export default cloudinary;
