/*
  content-script.js (see README.md)
*/

////////////// COPY OF LOGGING.JS //////////////////////////

const isDebug = !('update_url' in chrome.runtime.getManifest());

function delog(message) {
    if(isDebug) {
        console.log(message);
    }
}

function traceMethod(func) {
    function updatedFunc(...args) {
        delog("######################")
        delog("")
        delog("Calling Function>>>>>>")
        delog(func.name)
        for(const arg of args) {
            delog(arg)
        }
        result = func.apply(this, args)
        delog("Function Returns<<<<")
        delog(result)
        delog("")
        delog("#####################")
    }

    return updatedFunc
}

////////////////// COPY OF data-storage.js ////////////////////////

const getStoragePromise = (key) => {
    return chrome.storage.local.get([key]);
}

const setStoragePromise = (key, value) => {
  return chrome.storage.local.set({[key]: value});
}

const userDataKey = "userDataKey";
const problemsKey = "problemsKey";
const recentSubmissionsKey = "recentSubmissionsKey";

const PROBLEMS_JSON_URL = "https://raw.githubusercontent.com/vviseguy/interview-ready-byu/refs/heads/feat/github-problem-data/data/problems.json";
const PROBLEM_POLL_MIN_MS = 5 * 60 * 1000;
const RECENT_POLL_MIN_MS = 5 * 60 * 1000;
const RECENT_OVERLAP_SECONDS = 6 * 60 * 60; // 6 hours overlap

const getRecentAcceptedSet = (recentAcceptedSubmissions) => {
  const recentAccepted = new Set();

  if (Array.isArray(recentAcceptedSubmissions?.slugs)) {
    for (const slug of recentAcceptedSubmissions.slugs) {
      recentAccepted.add(slug);
    }
    return recentAccepted;
  }

  const acList = recentAcceptedSubmissions?.data?.recentAcSubmissionList;
  if (acList?.length > 0) {
    for (const item of acList) {
      recentAccepted.add(item.titleSlug);
    }
  }

  return recentAccepted;
};

/////////////////////////// END COPIES ///////////////////////////


/**
 * Query data from leetcode apis
 */
async function queryData(queryBody) {
  const response = await fetch(
    "https://leetcode.com/graphql/",
    {
      "headers": {
        "content-type": "application/json",
      },
      "body": queryBody,
      "method": "POST"
    });
  delog("querying");
  return await response.json();
}

async function updateRecentAcceptedSubmissions() {
  const userData = (await chrome.storage.local.get([userDataKey])).userDataKey;
  const username = userData?.username;
  if (!username) {
    delog("No username available; skipping recent accepts update.");
    return;
  }

  const oldValue = (await chrome.storage.local.get([recentSubmissionsKey])).recentSubmissionsKey;
  const lastUpdate = oldValue?.timeStamp ?? 0;
  if (Date.now() - lastUpdate < RECENT_POLL_MIN_MS) {
    delog("Recent accepts update skipped (dedup interval)." );
    return;
  }

  const result = await queryData(JSON.stringify({"query":"\n    query recentAcSubmissions($username: String!, $limit: Int!) {\n  recentAcSubmissionList(username: $username, limit: $limit) {\n    id\n    title\n    titleSlug\n    timestamp\n  }\n}\n    ","variables":{"username":username,"limit":15},"operationName":"recentAcSubmissions"}));
  let stringValue = JSON.stringify(result);
  delog("Comparing string values");
  delog(stringValue);
  delog(oldValue?.stringValue);
  const existingAccepted = getRecentAcceptedSet(oldValue);
  const incoming = result?.data?.recentAcSubmissionList ?? [];
  const lastAcceptedTimestamp = oldValue?.lastAcceptedTimestamp ?? 0;
  const threshold = Math.max(0, lastAcceptedTimestamp - RECENT_OVERLAP_SECONDS);

  for (const item of incoming) {
    const itemTimestamp = Number(item.timestamp) || 0;
    if (itemTimestamp >= threshold) {
      existingAccepted.add(item.titleSlug);
    }
  }

  const slugs = Array.from(existingAccepted);
  const newMaxTimestamp = incoming.reduce((max, item) => {
    const ts = Number(item.timestamp) || 0;
    return ts > max ? ts : max;
  }, lastAcceptedTimestamp);

  const oldSlugs = Array.isArray(oldValue?.slugs) ? oldValue.slugs.slice().sort() : [];
  const newSlugs = slugs.slice().sort();

  if (oldValue?.stringValue == stringValue && JSON.stringify(oldSlugs) === JSON.stringify(newSlugs)) {
    delog("nothing has changed, not updating...")
    return;
  }

  result.timeStamp = Date.now();
  result.stringValue = stringValue;
  result.slugs = slugs;
  result.lastAcceptedTimestamp = newMaxTimestamp;
  chrome.storage.local.set({recentSubmissionsKey: result});
  delog("Setting...." + recentSubmissionsKey);
  delog(result);
  delog(".....");
}


async function updateAllProblems() {
  const oldValue = (await chrome.storage.local.get([problemsKey])).problemsKey;
  const lastUpdate = oldValue?.timeStamp ?? 0;
  if (Date.now() - lastUpdate < PROBLEM_POLL_MIN_MS) {
    delog("Problems update skipped (dedup interval)." );
    return;
  }

  const response = await fetch(PROBLEMS_JSON_URL, { cache: "no-store" });
  if (!response.ok) {
    delog("Failed to fetch problems JSON from repo.");
    return;
  }

  const result = await response.json();
  const stringValue = JSON.stringify(result);
  if (oldValue?.stringValue == stringValue) {
    delog("Problems JSON unchanged; not updating.");
    return;
  }

  result.timeStamp = Date.now();
  result.stringValue = stringValue;
  chrome.storage.local.set({problemsKey: result});
  delog("Setting...." + problemsKey);
  delog(result);
  delog(".....");
};


async function updateUserStatus() {
  const query = JSON.stringify({
    operationName: "globalData",
    query: "query globalData {userStatus {isSignedIn isPremium username realName avatar}}",
    variables: {}
  });
  const result = await queryData(query);
  chrome.storage.local.set({userDataKey: result.data.userStatus});
  delog("Setting...." + userDataKey);
  delog(result);
  delog(".....");
  if(!result.data.userStatus.isSignedIn) {
    delog("not signed in will run again if some tab signs in");
  } else {
    updateAllProblems();
  }
}

/**
 * Refresh data when leetcode is opened on any tab:
 */
updateUserStatus();

function changeListener(changes, namespace) {
  for (let [key, {oldValue, newValue}] of Object.entries(changes)) {
    console.log(`CHANGE ${key}`);
    delog(`CHANGE ${key}`);
    if(key == "refresh_problems" && oldValue != newValue) {
      delog(oldValue);
      delog(newValue);
      updateAllProblems();
    }
    else if(key == "modal_opened" && oldValue != newValue) {
      delog(oldValue);
      delog(newValue);
      updateRecentAcceptedSubmissions();
    }
  }
}

chrome.storage.onChanged.addListener(changeListener);

