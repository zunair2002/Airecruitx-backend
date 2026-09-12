import { Job } from "../../../shared/job/model/job.model";
import { OrgInterviewQuestionSet, IOrgInterviewQuestion } from "../model/orgInterviewQuestionSet.model";
import { AppError } from "../../../utils/AppError";
import { extractTextFromFile } from "../../../shared/util/extractTextFromFile";

const requireOwnedJob = async (hrId: string, jobId: string) => {
  const job = await Job.findOne({ _id: jobId, hrId });
  if (!job) {
    throw new AppError("Job not found", 404);
  }
  return job;
};

// Two question-start styles are accepted, so HR doesn't have to reformat an existing
// document: a "Q:" label, or a plain numbered list ("1.", "2)", ...) — the latter is
// how people naturally write these documents in Word/Google Docs without thinking
// about a machine-readable format at all.
const QUESTION_LINE = /^(?:Q(?:uestion)?\s*\d*\s*:|\d+[.)])\s*(.*)$/i;
const ANSWER_LINE = /^(?:A(?:nswer)?|Reference\s*Answer)\s*:\s*(.*)$/i;
const MARKS_LINE = /^(?:Marks|Points)\s*:\s*(\d+(?:\.\d+)?)\s*$/i;

// Most HR docs won't bother assigning marks per question at all — this keeps the
// upload from failing outright when Marks:/Points: lines are simply absent; every
// question in the file then carries this default weight.
const DEFAULT_MARKS = 10;

export const parseQuestionPoolText = (text: string): IOrgInterviewQuestion[] => {
  const lines = text.replace(/\r\n/g, "\n").split("\n");

  const questions: IOrgInterviewQuestion[] = [];
  let current: { question?: string; referenceAnswer?: string; marks?: number } = {};
  let activeField: "question" | "referenceAnswer" | null = null;

  const flush = () => {
    if (current.question && current.referenceAnswer) {
      questions.push({
        question: current.question.trim(),
        referenceAnswer: current.referenceAnswer.trim(),
        marks: current.marks ?? DEFAULT_MARKS,
      });
    }
    current = {};
    activeField = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const questionMatch = line.match(QUESTION_LINE);
    const answerMatch = line.match(ANSWER_LINE);
    const marksMatch = line.match(MARKS_LINE);

    if (questionMatch) {
      flush(); // a new question line always starts the next block
      current.question = questionMatch[1];
      activeField = "question";
    } else if (answerMatch) {
      current.referenceAnswer = answerMatch[1];
      activeField = "referenceAnswer";
    } else if (marksMatch) {
      current.marks = parseFloat(marksMatch[1]);
      activeField = null;
    } else if (activeField === "question") {
      current.question = `${current.question ?? ""} ${line}`;
    } else if (activeField === "referenceAnswer") {
      current.referenceAnswer = `${current.referenceAnswer ?? ""} ${line}`;
    }
    // Lines outside any recognized field (stray text, headers) are ignored.
  }
  flush();

  if (questions.length === 0) {
    throw new AppError(
      "Could not find any questions in the file. Each question needs a question line " +
        '("Q: ..." or "1. ...") followed by an answer line ("A: ..." or "Answer: ..."), e.g.:\n' +
        "Q: What is SQL Injection?\nA: <reference answer>\n\n(an optional \"Marks: 10\" line sets that " +
        `question's weight — questions without one default to ${DEFAULT_MARKS}.)`,
      422
    );
  }

  return questions;
};

interface UploadQuestionSetInput {
  file: Express.Multer.File;
  questionsPerInterview?: number;
}

export const uploadQuestionSet = async (hrId: string, jobId: string, input: UploadQuestionSetInput) => {
  await requireOwnedJob(hrId, jobId);

  if (input.questionsPerInterview !== undefined) {
    if (!Number.isFinite(input.questionsPerInterview) || input.questionsPerInterview <= 0) {
      throw new AppError("questionsPerInterview must be a positive number", 400);
    }
  }

  const text = await extractTextFromFile(input.file.buffer, input.file.mimetype);
  const questions = parseQuestionPoolText(text);

  return OrgInterviewQuestionSet.findOneAndUpdate(
    { jobId },
    { jobId, hrId, questions, questionsPerInterview: input.questionsPerInterview },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

export const getQuestionSet = async (hrId: string, jobId: string) => {
  await requireOwnedJob(hrId, jobId);
  return OrgInterviewQuestionSet.findOne({ jobId });
};
