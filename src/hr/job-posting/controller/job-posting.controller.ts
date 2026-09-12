import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/asyncHandler";
import { AppError } from "../../../utils/AppError";
import * as jobPostingService from "../service/job-posting.service";
import * as questionSetService from "../service/orgInterviewQuestionSet.service";

export const createJobHandler = asyncHandler(async (req: Request, res: Response) => {
  const hrId = req.user!._id.toString();
  const { title, description, requiredSkills } = req.body ?? {};

  // multipart form fields always arrive as strings — accept either a comma-separated
  // string (from the JD-upload form) or an array (plain JSON callers).
  const requiredSkillsArray = Array.isArray(requiredSkills)
    ? requiredSkills
    : typeof requiredSkills === "string" && requiredSkills.length > 0
      ? requiredSkills.split(",")
      : [];

  const job = await jobPostingService.createJob(hrId, {
    title,
    description,
    requiredSkills: requiredSkillsArray,
    jdFile: req.file,
  });

  res.status(201).json({ success: true, data: job });
});

export const listMyJobsHandler = asyncHandler(async (req: Request, res: Response) => {
  const hrId = req.user!._id.toString();
  const jobs = await jobPostingService.listJobsForHr(hrId);

  res.status(200).json({ success: true, data: jobs });
});

// Replaces the whole organizational-interview question pool for a job from an
// uploaded PDF/DOCX ("Q: / A: / Marks:" per question — see
// orgInterviewQuestionSet.service.ts) instead of HR typing each question into a form.
// questionsPerInterview (optional) caps how many of the pool's questions each
// candidate is actually asked, drawn at random and shuffled per candidate.
export const uploadQuestionSetHandler = asyncHandler(async (req: Request, res: Response) => {
  const hrId = req.user!._id.toString();
  const { questionsPerInterview } = req.body ?? {};

  if (!req.file) {
    throw new AppError("A questions file (PDF or DOCX) is required", 400);
  }

  const questionSet = await questionSetService.uploadQuestionSet(hrId, req.params.jobId, {
    file: req.file,
    questionsPerInterview: questionsPerInterview !== undefined ? Number(questionsPerInterview) : undefined,
  });

  res.status(200).json({ success: true, data: questionSet });
});

export const getQuestionSetHandler = asyncHandler(async (req: Request, res: Response) => {
  const hrId = req.user!._id.toString();
  const questionSet = await questionSetService.getQuestionSet(hrId, req.params.jobId);

  res.status(200).json({ success: true, data: questionSet });
});
