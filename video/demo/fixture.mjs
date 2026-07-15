import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";

const templatePath = fileURLToPath(new URL("./job-page.html", import.meta.url));

const pad = (value) => String(value).padStart(2, "0");

const formatLocalDate = (date) => {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

export const getFixtureDates = (now = new Date()) => {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const posted = new Date(startOfToday);
  const deadline = new Date(startOfToday);

  posted.setDate(posted.getDate() - 7);
  deadline.setDate(deadline.getDate() + 31);

  return {
    posted: formatLocalDate(posted),
    deadline: formatLocalDate(deadline),
  };
};

export const renderFixture = async (now = new Date()) => {
  const template = await readFile(templatePath, "utf8");
  const dates = getFixtureDates(now);

  return template
    .replaceAll("__DATE_POSTED__", dates.posted)
    .replaceAll("__VALID_THROUGH__", dates.deadline);
};
