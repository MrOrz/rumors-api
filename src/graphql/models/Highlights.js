import { GraphQLObjectType, GraphQLString, GraphQLList } from 'graphql';
import Hyperlink from './Hyperlink';

const Highlights = new GraphQLObjectType({
  name: 'Highlights',
  fields: {
    text: { type: GraphQLString },
    hyperlinks: { type: new GraphQLList(Hyperlink) },
  },
});

export default Highlights;
