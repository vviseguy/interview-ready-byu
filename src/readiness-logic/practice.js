import { getNextPracticeProblem, getReadinessData, recommendedList } from "./classic.js";
import { targetTopics } from "./target-topics.js";
import { delog, traceMethod } from "../shared/logging.js"
import { randomElementInArray } from "./random.js";
const getAcceptedSet = (recentAcceptedSubmissions) => {
    let recentAccepted = new Set();
  
    let acList = recentAcceptedSubmissions?.data?.recentAcSubmissionList;
    if (acList?.length > 0) {
      for(let item of acList) {
        recentAccepted.add(item.titleSlug);
      }
    }
  
    return recentAccepted;
  }

export async function getPracticeProblem(practiceType) {
    const allProblems = (await chrome.storage.local.get(["problemsKey"])).problemsKey;
    if (!allProblems?.data?.problemsetQuestionList?.questions) {
        delog("No problems data available for practice problem selection");
        return null;
    }
    const recentAcceptedData = (await chrome.storage.local.get(["recentSubmissionsKey"])).recentSubmissionsKey;
    const recentAcceptedSet = getAcceptedSet(recentAcceptedData);

    if(practiceType == "suggested") {
        const acceptedSet = new Set();
        allProblems.data.problemsetQuestionList.questions.forEach((question) => {
            if(question.status == "ac" || recentAcceptedSet.has(question.titleSlug)) {
                acceptedSet.add(question.titleSlug);
            }
        });

        for(const slug of recommendedList) {
            if (!acceptedSet.has(slug)) {
                return slug;
            }
        }

        delog("They've done all the recommended problems! Wow!");

        let readinessData = await getReadinessData(allProblems);

        for(const topic of targetTopics) {
            if (readinessData[topic][0] != "ready") {
                return await getNextPracticeProblem(topic, "suggested");
            }
        }
    } else if (practiceType == "review") {
        const acceptedList = [];
        allProblems.data.problemsetQuestionList.questions.forEach((question) => {
            if(question.status == "ac" || recentAcceptedSet.has(question.titleSlug)) {
                acceptedList.push(question.titleSlug);
            }
        });

        if(acceptedList.length == 0) {
            return null;
        }

        return randomElementInArray(acceptedList);
    } else if (practiceType == "random") {
        const randomTopic = randomElementInArray(targetTopics);
        return getNextPracticeProblem(randomTopic, "suggested");
    }

}