package chain

import (
	"testing"

	"github.com/pattonkan/sui-go/sui"
	"github.com/pattonkan/sui-go/suiclient"
)

// makeCreatedChange builds a WrapperTaggedJson[ObjectChange] for a Created object.
func makeCreatedChange(objectID *sui.ObjectId, objectType string) suiclient.WrapperTaggedJson[suiclient.ObjectChange] {
	return suiclient.WrapperTaggedJson[suiclient.ObjectChange]{
		Data: suiclient.ObjectChange{
			Created: &struct {
				Sender     sui.Address           `json:"sender"`
				Owner      suiclient.ObjectOwner  `json:"owner"`
				ObjectType sui.ObjectType         `json:"objectType"`
				ObjectId   sui.ObjectId           `json:"objectId"`
				Version    *sui.BigInt            `json:"version"`
				Digest     sui.ObjectDigest       `json:"digest"`
			}{
				ObjectId:   *objectID,
				ObjectType: sui.ObjectType(objectType),
			},
		},
	}
}

func TestExtractCreatedContracts_MultipleTypes(t *testing.T) {
	objID1 := sui.MustObjectIdFromHex("0x0000000000000000000000000000000000000000000000000000000000000001")
	objID2 := sui.MustObjectIdFromHex("0x0000000000000000000000000000000000000000000000000000000000000002")
	objID3 := sui.MustObjectIdFromHex("0x0000000000000000000000000000000000000000000000000000000000000003")

	resp := &suiclient.SuiTransactionBlockResponse{
		ObjectChanges: []suiclient.WrapperTaggedJson[suiclient.ObjectChange]{
			makeCreatedChange(objID1, "0xabc::coin_for_item::CoinForItemContract<0xabc::corm_coin::CORM_COIN>"),
			makeCreatedChange(objID2, "0xabc::item_for_coin::ItemForCoinContract<0xabc::corm_coin::CORM_COIN>"),
			makeCreatedChange(objID3, "0xabc::coin_for_item::CoinForItemContract<0xabc::corm_coin::CORM_COIN>"),
		},
	}

	typeSubstrings := []string{
		"coin_for_item::CoinForItemContract",
		"item_for_coin::ItemForCoinContract",
		"coin_for_item::CoinForItemContract",
	}

	ids := extractCreatedContracts(resp, typeSubstrings)

	if len(ids) != 3 {
		t.Fatalf("expected 3 IDs, got %d", len(ids))
	}
	if ids[0] != objID1.String() {
		t.Errorf("ids[0]: expected %s, got %s", objID1.String(), ids[0])
	}
	if ids[1] != objID2.String() {
		t.Errorf("ids[1]: expected %s, got %s", objID2.String(), ids[1])
	}
	// ids[2] should match the second coin_for_item (objID3), not re-use objID1.
	if ids[2] != objID3.String() {
		t.Errorf("ids[2]: expected %s (second coin_for_item), got %s", objID3.String(), ids[2])
	}
}

func TestExtractCreatedContracts_MissingContract(t *testing.T) {
	objID1 := sui.MustObjectIdFromHex("0x0000000000000000000000000000000000000000000000000000000000000001")

	resp := &suiclient.SuiTransactionBlockResponse{
		ObjectChanges: []suiclient.WrapperTaggedJson[suiclient.ObjectChange]{
			makeCreatedChange(objID1, "0xabc::coin_for_item::CoinForItemContract<0xabc::corm_coin::CORM_COIN>"),
		},
	}

	typeSubstrings := []string{
		"coin_for_item::CoinForItemContract",
		"item_for_item::ItemForItemContract", // not present in changes
	}

	ids := extractCreatedContracts(resp, typeSubstrings)

	if len(ids) != 2 {
		t.Fatalf("expected 2 IDs, got %d", len(ids))
	}
	if ids[0] != objID1.String() {
		t.Errorf("ids[0]: expected %s, got %s", objID1.String(), ids[0])
	}
	if ids[1] != "" {
		t.Errorf("ids[1]: expected empty for missing contract, got %s", ids[1])
	}
}

func TestExtractCreatedContracts_Empty(t *testing.T) {
	resp := &suiclient.SuiTransactionBlockResponse{}
	ids := extractCreatedContracts(resp, []string{"coin_for_item::CoinForItemContract"})
	if len(ids) != 1 {
		t.Fatalf("expected 1 ID, got %d", len(ids))
	}
	if ids[0] != "" {
		t.Errorf("expected empty ID, got %s", ids[0])
	}
}

func TestExtractCreatedContract_SingleBackwardCompat(t *testing.T) {
	objID := sui.MustObjectIdFromHex("0x0000000000000000000000000000000000000000000000000000000000000042")

	resp := &suiclient.SuiTransactionBlockResponse{
		ObjectChanges: []suiclient.WrapperTaggedJson[suiclient.ObjectChange]{
			makeCreatedChange(objID, "0xabc::coin_for_item::CoinForItemContract<0xabc::corm_coin::CORM_COIN>"),
		},
	}

	// Original single-contract helper should still work.
	id := extractCreatedContract(resp, "coin_for_item::CoinForItemContract")
	if id != objID.String() {
		t.Errorf("expected %s, got %s", objID.String(), id)
	}
}
