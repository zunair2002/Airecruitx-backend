import type { ParsedResume } from "./resumeParser";

export type ResumeParseStatus = "parsed" | "partial" | "failed";

export interface ResumeValidation {
  status: ResumeParseStatus;
  errors: string[];
  warnings: string[];
}

export const validateParsedResume = (
  parsedResume: ParsedResume | undefined,
  failureCode?: string,
): ResumeValidation => {
  if (!parsedResume) {
    return {
      status: "failed",
      errors: [failureCode ?? "resume_parser_returned_no_data"],
      warnings: [],
    };
  }

  const errors: string[] = [];
  const warnings = [...parsedResume.warnings];
  if (
    !parsedResume.parserProvider.trim() ||
    !parsedResume.parserVersion.trim()
  ) {
    errors.push("parser_metadata_missing");
  }
  if (!Array.isArray(parsedResume.skills)) errors.push("skills_data_invalid");
  if (!Array.isArray(parsedResume.experience)) {
    errors.push("experience_data_invalid");
  }
  if (!Array.isArray(parsedResume.education)) {
    errors.push("education_data_invalid");
  }
  if (!Array.isArray(parsedResume.certifications)) {
    errors.push("certifications_data_invalid");
  }
  if (!Array.isArray(parsedResume.projects)) {
    errors.push("projects_data_invalid");
  }
  if (!parsedResume.fullName) warnings.push("name_not_detected");
  if (!parsedResume.email) warnings.push("email_not_detected");
  if (!parsedResume.skills.length) warnings.push("no_skills_extracted");

  return {
    status: errors.length ? "failed" : warnings.length ? "partial" : "parsed",
    errors,
    warnings: [...new Set(warnings)],
  };
};
