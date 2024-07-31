package spx_backend

import (
	"context"
	"github.com/milvus-io/milvus-sdk-go/v2/client"
	"github.com/milvus-io/milvus-sdk-go/v2/entity"
	"log"
)

func NewCollection() {
	// connect to  milvus
	ctx := context.Background()
	cli, err := client.NewGrpcClient(ctx, "localhost:19530")
	if err != nil {
		log.Fatalf("Failed to connect to Milvus: %v", err)
	}
	defer cli.Close()

	// define fields
	idField := &entity.Field{
		Name:       "id",
		DataType:   entity.FieldTypeInt64,
		PrimaryKey: true,
		AutoID:     true,
	}

	vectorField := &entity.Field{
		Name:     "vector",
		DataType: entity.FieldTypeFloatVector,
		TypeParams: map[string]string{
			"dim": "256",
		},
	}

	assetIDField := &entity.Field{
		Name:     "asset_id",
		DataType: entity.FieldTypeVarChar,
		TypeParams: map[string]string{
			"max_length": "10",
		},
	}

	// define collection schema
	schema := &entity.Schema{
		CollectionName: "asset",
		Fields:         []*entity.Field{idField, vectorField, assetIDField},
	}

	// create collection
	err = cli.CreateCollection(ctx, schema, 1)
	if err != nil {
		log.Fatalf("Failed to create collection: %v", err)
	}
}
