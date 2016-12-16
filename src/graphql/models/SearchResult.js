import {
  GraphQLObjectType,
  GraphQLFloat,
  GraphQLList,
  GraphQLUnionType,
  GraphQLEnumType,
} from 'graphql';

import Answer from 'graphql/models/Answer';
import Rumor from 'graphql/models/Rumor';
import CrawledDoc from 'graphql/models/CrawledDoc';

function scoredDocFactory(name, type) {
  return new GraphQLObjectType({
    name,
    fields: {
      score: { type: GraphQLFloat },
      doc: { type },
    },
  });
}

const ResultDocument = new GraphQLUnionType({
  name: 'ResultDocument',
  types: [Rumor, Answer, CrawledDoc],
  resolveType(result) {
    if (!result) return CrawledDoc;

    switch (result._type) {
      case 'RUMOR': return Rumor;
      case 'ANSWER': return Answer;
      default: return CrawledDoc;
    }
  },
});

function theBestDoc(scoredDocs) {
  // If the first match has score > 10,
  // or the first match is 2x larger than the second match,
  // return the first match.
  if (
    (scoredDocs.length >= 1 && scoredDocs[0].score > 10) ||
    (scoredDocs.length > 1 && scoredDocs[0].score > 2 * scoredDocs[1].score)
  ) {
    return scoredDocs[0];
  }

  return null;
}

export default new GraphQLObjectType({
  name: 'SearchResult',
  fields: () => ({
    rumors: { type: new GraphQLList(scoredDocFactory('ScoredRumor', Rumor)) },
    answers: { type: new GraphQLList(scoredDocFactory('ScoredAnswer', Answer)) },
    crawledDoc: { type: new GraphQLList(scoredDocFactory('ScoredCrawledDoc', CrawledDoc)) },
    suggestedResult: {
      description: 'The document that is the best match in this search.',
      type: ResultDocument,
      resolve({ rumors: scoredRumors, answers: scoredAnswers, crawledDocs: scoredCrawledDocs }) {
        const bestScoredRumor = theBestDoc(scoredRumors);
        if (bestScoredRumor) {
          return {
            ...bestScoredRumor.doc, _type: 'RUMOR',
          };
        }

        const bestScoredAnswer = theBestDoc(scoredAnswers);
        if (bestScoredAnswer) {
          return {
            ...bestScoredAnswer.doc, _type: 'ANSWER',
          };
        }

        const bestScoredCrawledDoc = theBestDoc(scoredCrawledDocs);
        if (bestScoredCrawledDoc) {
          return {
            ...bestScoredCrawledDoc.doc, _type: 'CRAWLED_DOC',
          };
        }

        return null;
      },
    },
  }),
});
